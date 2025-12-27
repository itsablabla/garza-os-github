import asyncio
import json
import os
import logging
import uuid
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

import aiosqlite
import aiohttp
from nio import (
    RoomKeyRequest,
    RoomKeyRequestCancellation,
    AsyncClient,
    AsyncClientConfig,
    MatrixRoom,
    RoomMessageText,
    RoomMessageAudio,
    RoomMessageMedia,
    SyncResponse,
    LoginResponse,
    MegolmEvent,
    KeysUploadResponse,
)
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HOMESERVER = os.getenv("MATRIX_HOMESERVER", "https://matrix.beeper.com")
USER_ID = os.getenv("MATRIX_USER_ID", "")
ACCESS_TOKEN = os.getenv("MATRIX_ACCESS_TOKEN", "")
PASSWORD = os.getenv("MATRIX_PASSWORD", "")
TOKEN_FILE = "/data/access_token.json"
SYNC_TOKEN_FILE = "/data/sync_token.json"
STORE_PATH = "/data/crypto_store"
DB_PATH = "/data/beeper.db"

matrix_client: Optional[AsyncClient] = None
db: Optional[aiosqlite.Connection] = None
device_id: Optional[str] = None


async def init_db():
    global db
    os.makedirs("/data", exist_ok=True)
    os.makedirs(STORE_PATH, exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS rooms (
            room_id TEXT PRIMARY KEY,
            name TEXT,
            is_direct INTEGER DEFAULT 0,
            last_message_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            event_id TEXT PRIMARY KEY,
            room_id TEXT,
            sender TEXT,
            body TEXT,
            msg_type TEXT,
            mxc_url TEXT,
            mimetype TEXT,
            filename TEXT,
            file_size INTEGER,
            timestamp INTEGER,
            created_at TEXT,
            FOREIGN KEY (room_id) REFERENCES rooms(room_id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_body ON messages(body);
        CREATE INDEX IF NOT EXISTS idx_messages_mxc ON messages(mxc_url);
    """)
    await db.commit()
    logger.info("Database initialized")


async def store_room(room: MatrixRoom):
    is_direct = 0
    if hasattr(room, 'is_direct'):
        is_direct = 1 if room.is_direct else 0
    elif hasattr(room, 'member_count') and room.member_count == 2:
        is_direct = 1
        
    await db.execute("""
        INSERT OR REPLACE INTO rooms (room_id, name, is_direct, updated_at)
        VALUES (?, ?, ?, ?)
    """, (room.room_id, room.display_name, is_direct, datetime.utcnow().isoformat()))
    await db.commit()


async def store_message(room_id: str, event, mxc_url=None, mimetype=None, filename=None, file_size=None):
    body = getattr(event, 'body', '') or ''
    msg_type = getattr(event, 'msgtype', 'unknown')
    
    await db.execute("""
        INSERT OR IGNORE INTO messages (event_id, room_id, sender, body, msg_type, mxc_url, mimetype, filename, file_size, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (event.event_id, room_id, event.sender, body, msg_type, mxc_url, mimetype, filename, file_size, event.server_timestamp, datetime.utcnow().isoformat()))
    
    await db.execute("UPDATE rooms SET last_message_at = ? WHERE room_id = ?", (datetime.utcnow().isoformat(), room_id))
    await db.commit()


async def message_callback(room: MatrixRoom, event):
    await store_room(room)
    await store_message(room.room_id, event)
    logger.debug(f"[{room.display_name}] {event.sender}: {event.body[:50] if event.body else ''}...")


async def audio_callback(room: MatrixRoom, event: RoomMessageAudio):
    """Handle audio/voice messages"""
    await store_room(room)
    mxc_url = getattr(event, 'url', None)
    mimetype = None
    filename = None
    file_size = None
    
    if hasattr(event, 'source') and event.source:
        content = event.source.get('content', {})
        info = content.get('info', {})
        mimetype = info.get('mimetype')
        file_size = info.get('size')
        filename = content.get('body', content.get('filename'))
        if not mxc_url:
            mxc_url = content.get('url')
    
    await store_message(room.room_id, event, mxc_url=mxc_url, mimetype=mimetype, filename=filename, file_size=file_size)
    logger.info(f"[{room.display_name}] Audio: {filename or 'voice memo'} ({mimetype}) - {mxc_url}")


async def media_callback(room: MatrixRoom, event: RoomMessageMedia):
    """Handle generic media messages"""
    await store_room(room)
    mxc_url = getattr(event, 'url', None)
    mimetype = None
    filename = None
    file_size = None
    
    if hasattr(event, 'source') and event.source:
        content = event.source.get('content', {})
        info = content.get('info', {})
        mimetype = info.get('mimetype')
        file_size = info.get('size')
        filename = content.get('body', content.get('filename'))
        if not mxc_url:
            mxc_url = content.get('url')
    
    await store_message(room.room_id, event, mxc_url=mxc_url, mimetype=mimetype, filename=filename, file_size=file_size)
    logger.info(f"[{room.display_name}] Media: {filename} ({mimetype})")


async def encrypted_callback(room: MatrixRoom, event: MegolmEvent):
    await store_room(room)
    logger.warning(f"Could not decrypt message in {room.display_name}: {event.session_id[:20]}...")


def load_saved_token():
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'r') as f:
            return json.load(f)
    return None


def save_token(user_id: str, device_id: str, access_token: str):
    with open(TOKEN_FILE, 'w') as f:
        json.dump({"user_id": user_id, "device_id": device_id, "access_token": access_token}, f)


def load_sync_token():
    if os.path.exists(SYNC_TOKEN_FILE):
        with open(SYNC_TOKEN_FILE, 'r') as f:
            data = json.load(f)
            return data.get("sync_token")
    return None


def save_sync_token(token: str):
    with open(SYNC_TOKEN_FILE, 'w') as f:
        json.dump({"sync_token": token}, f)


async def sync_forever():
    global matrix_client, device_id
    
    config = AsyncClientConfig(
        store_sync_tokens=True,
        encryption_enabled=True,
    )
    matrix_client = AsyncClient(HOMESERVER, USER_ID, store_path=STORE_PATH, config=config)
    
    saved = load_saved_token()
    if saved and saved.get("access_token"):
        logger.info(f"Using saved token for device {saved.get('device_id')}")
        matrix_client.access_token = saved["access_token"]
        matrix_client.device_id = saved["device_id"]
        matrix_client.user_id = saved["user_id"]
        device_id = saved["device_id"]
        
        if os.path.exists(STORE_PATH):
            matrix_client.load_store()
            logger.info("Loaded crypto store")
    else:
        logger.info("Performing fresh login...")
        resp = await matrix_client.login(PASSWORD, device_name="GarzaOS-Beeper")
        
        if isinstance(resp, LoginResponse):
            logger.info(f"Login successful! Device ID: {resp.device_id}")
            save_token(resp.user_id, resp.device_id, resp.access_token)
            device_id = resp.device_id
            
            keys_resp = await matrix_client.keys_upload()
            if isinstance(keys_resp, KeysUploadResponse):
                logger.info("Device keys uploaded successfully")
            else:
                logger.warning(f"Keys upload issue: {keys_resp}")
        else:
            logger.error(f"Login failed: {resp}")
            return
    
    matrix_client.add_event_callback(message_callback, RoomMessageText)
    matrix_client.add_event_callback(audio_callback, RoomMessageAudio)
    matrix_client.add_event_callback(media_callback, RoomMessageMedia)
    matrix_client.add_event_callback(encrypted_callback, MegolmEvent)
    
    sync_token = load_sync_token()
    if sync_token:
        logger.info(f"Resuming from sync token: {sync_token[:20]}...")
    else:
        logger.info("Starting fresh sync (incremental only, no full_state)")
    
    while True:
        try:
            sync_response = await matrix_client.sync(
                timeout=30000,
                since=sync_token,
                full_state=False,
            )
            
            if isinstance(sync_response, SyncResponse):
                for room_id, room in matrix_client.rooms.items():
                    await store_room(room)
                
                sync_token = sync_response.next_batch
                save_sync_token(sync_token)
                logger.debug(f"Synced, rooms: {len(matrix_client.rooms)}")
            else:
                logger.warning(f"Sync issue: {sync_response}")
                await asyncio.sleep(5)
                
        except Exception as e:
            logger.error(f"Sync error: {e}")
            await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    sync_task = asyncio.create_task(sync_forever())
    yield
    sync_task.cancel()
    if db:
        await db.close()


app = FastAPI(title="Beeper Fast MCP", lifespan=lifespan)


class SendMessageRequest(BaseModel):
    room_id: str
    message: str


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "matrix_connected": matrix_client is not None and matrix_client.access_token is not None,
        "rooms_synced": len(matrix_client.rooms) if matrix_client else 0,
        "device_id": matrix_client.device_id if matrix_client else None,
        "encryption_enabled": True,
    }


@app.get("/rooms")
async def list_rooms(limit: int = 50):
    cursor = await db.execute("""
        SELECT room_id, name, is_direct, last_message_at 
        FROM rooms 
        ORDER BY last_message_at DESC NULLS LAST
        LIMIT ?
    """, (limit,))
    rows = await cursor.fetchall()
    return [{"room_id": r[0], "name": r[1], "is_direct": bool(r[2]), "last_message_at": r[3]} for r in rows]


@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = 50):
    cursor = await db.execute("""
        SELECT event_id, sender, body, msg_type, mxc_url, mimetype, filename, file_size, timestamp 
        FROM messages 
        WHERE room_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    """, (room_id, limit))
    rows = await cursor.fetchall()
    return [{
        "event_id": r[0], 
        "sender": r[1], 
        "body": r[2], 
        "msg_type": r[3],
        "mxc_url": r[4],
        "mimetype": r[5],
        "filename": r[6],
        "file_size": r[7],
        "timestamp": r[8]
    } for r in rows]


@app.get("/search")
async def search_messages(q: str, limit: int = 20):
    cursor = await db.execute("""
        SELECT m.event_id, m.room_id, r.name as room_name, m.sender, m.body, m.mxc_url, m.mimetype, m.timestamp
        FROM messages m
        LEFT JOIN rooms r ON m.room_id = r.room_id
        WHERE m.body LIKE ?
        ORDER BY m.timestamp DESC
        LIMIT ?
    """, (f"%{q}%", limit))
    rows = await cursor.fetchall()
    return [{
        "event_id": r[0], 
        "room_id": r[1], 
        "room_name": r[2], 
        "sender": r[3], 
        "body": r[4],
        "mxc_url": r[5],
        "mimetype": r[6],
        "timestamp": r[7]
    } for r in rows]


@app.get("/media")
async def list_media(room_id: Optional[str] = None, limit: int = 50):
    """List media messages (voice memos, images, files)"""
    if room_id:
        cursor = await db.execute("""
            SELECT m.event_id, m.room_id, r.name as room_name, m.sender, m.body, m.msg_type, m.mxc_url, m.mimetype, m.filename, m.file_size, m.timestamp
            FROM messages m
            LEFT JOIN rooms r ON m.room_id = r.room_id
            WHERE m.mxc_url IS NOT NULL AND m.room_id = ?
            ORDER BY m.timestamp DESC
            LIMIT ?
        """, (room_id, limit))
    else:
        cursor = await db.execute("""
            SELECT m.event_id, m.room_id, r.name as room_name, m.sender, m.body, m.msg_type, m.mxc_url, m.mimetype, m.filename, m.file_size, m.timestamp
            FROM messages m
            LEFT JOIN rooms r ON m.room_id = r.room_id
            WHERE m.mxc_url IS NOT NULL
            ORDER BY m.timestamp DESC
            LIMIT ?
        """, (limit,))
    rows = await cursor.fetchall()
    return [{
        "event_id": r[0],
        "room_id": r[1],
        "room_name": r[2],
        "sender": r[3],
        "body": r[4],
        "msg_type": r[5],
        "mxc_url": r[6],
        "mimetype": r[7],
        "filename": r[8],
        "file_size": r[9],
        "timestamp": r[10]
    } for r in rows]


@app.get("/media/download")
async def download_media(mxc_url: str):
    """Download media file from Matrix server. mxc_url format: mxc://server/media_id"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    if not mxc_url.startswith("mxc://"):
        raise HTTPException(400, "Invalid mxc URL format")
    
    parts = mxc_url[6:].split("/", 1)
    if len(parts) != 2:
        raise HTTPException(400, "Invalid mxc URL format")
    
    server_name, media_id = parts
    download_url = f"{HOMESERVER}/_matrix/client/v1/media/download/{server_name}/{media_id}"
    
    async with aiohttp.ClientSession() as session:
        async with session.get(
            download_url,
            headers={"Authorization": f"Bearer {load_saved_token().get('access_token')}"}
        ) as resp:
            if resp.status == 200:
                content_type = resp.headers.get("Content-Type", "application/octet-stream")
                content_disposition = resp.headers.get("Content-Disposition", "")
                
                async def stream_content():
                    async for chunk in resp.content.iter_chunked(8192):
                        yield chunk
                
                return StreamingResponse(
                    stream_content(),
                    media_type=content_type,
                    headers={"Content-Disposition": content_disposition} if content_disposition else {}
                )
            else:
                error = await resp.text()
                raise HTTPException(resp.status, f"Failed to download: {error}")


@app.post("/send")
async def send_message(req: SendMessageRequest):
    """Send message using direct HTTP API (works for any room)"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    import urllib.parse
    room_id_encoded = urllib.parse.quote(req.room_id)
    txn_id = str(uuid.uuid4())
    
    url = f"{HOMESERVER}/_matrix/client/v3/rooms/{room_id_encoded}/send/m.room.message/{txn_id}"
    
    async with aiohttp.ClientSession() as session:
        async with session.put(
            url,
            headers={"Authorization": f"Bearer {load_saved_token().get('access_token')}"},
            json={"msgtype": "m.text", "body": req.message}
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                return {"status": "sent", "event_id": data.get("event_id")}
            else:
                error = await resp.text()
                raise HTTPException(resp.status, f"Failed to send: {error}")


@app.get("/room/find")
async def find_room(q: str):
    cursor = await db.execute("""
        SELECT room_id, name, is_direct 
        FROM rooms 
        WHERE name LIKE ?
        LIMIT 10
    """, (f"%{q}%",))
    rows = await cursor.fetchall()
    return [{"room_id": r[0], "name": r[1], "is_direct": bool(r[2])} for r in rows]


@app.get("/client/rooms")
async def client_rooms():
    """Show rooms the client has in memory"""
    if not matrix_client:
        return []
    return [{"room_id": rid, "name": room.display_name} for rid, room in matrix_client.rooms.items()]


@app.get("/backfill")
async def backfill_room(room_id: str, limit: int = 100):
    """Fetch historical messages from a room including voice memos/media"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    import urllib.parse
    room_id_encoded = urllib.parse.quote(room_id)
    
    url = f"{HOMESERVER}/_matrix/client/v3/rooms/{room_id_encoded}/messages"
    params = {"dir": "b", "limit": limit}
    
    messages_stored = 0
    media_found = 0
    
    async with aiohttp.ClientSession() as session:
        async with session.get(
            url,
            headers={"Authorization": f"Bearer {load_saved_token().get('access_token')}"},
            params=params
        ) as resp:
            if resp.status != 200:
                error = await resp.text()
                raise HTTPException(resp.status, f"Failed to fetch: {error}")
            
            data = await resp.json()
            events = data.get("chunk", [])
            
            for event in events:
                event_id = event.get("event_id")
                event_type = event.get("type")
                sender = event.get("sender")
                timestamp = event.get("origin_server_ts", 0)
                content = event.get("content", {})
                
                if event_type != "m.room.message":
                    continue
                
                msg_type = content.get("msgtype", "")
                body = content.get("body", "")
                mxc_url = content.get("url")
                mimetype = content.get("info", {}).get("mimetype")
                filename = content.get("filename") or content.get("body")
                file_size = content.get("info", {}).get("size")
                
                await db.execute("""
                    INSERT OR IGNORE INTO messages 
                    (event_id, room_id, sender, body, msg_type, mxc_url, mimetype, filename, file_size, timestamp, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (event_id, room_id, sender, body, msg_type, mxc_url, mimetype, filename, file_size, timestamp, datetime.utcnow().isoformat()))
                
                messages_stored += 1
                if mxc_url:
                    media_found += 1
            
            await db.commit()
            
            return {
                "status": "ok",
                "room_id": room_id,
                "messages_stored": messages_stored,
                "media_found": media_found,
                "end_token": data.get("end"),
            }


@app.get("/backfill/all")
async def backfill_all_media(room_id: str, max_messages: int = 1000):
    """Deep backfill - keep fetching until we hit max or run out of messages"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    import urllib.parse
    room_id_encoded = urllib.parse.quote(room_id)
    
    total_messages = 0
    total_media = 0
    token = None
    batch = 0
    
    async with aiohttp.ClientSession() as session:
        while total_messages < max_messages:
            batch += 1
            url = f"{HOMESERVER}/_matrix/client/v3/rooms/{room_id_encoded}/messages"
            params = {"dir": "b", "limit": 100}
            if token:
                params["from"] = token
            
            async with session.get(
                url,
                headers={"Authorization": f"Bearer {load_saved_token().get('access_token')}"},
                params=params
            ) as resp:
                if resp.status != 200:
                    break
                
                data = await resp.json()
                events = data.get("chunk", [])
                
                if not events:
                    break
                
                for event in events:
                    event_id = event.get("event_id")
                    event_type = event.get("type")
                    sender = event.get("sender")
                    timestamp = event.get("origin_server_ts", 0)
                    content = event.get("content", {})
                    
                    if event_type != "m.room.message":
                        continue
                    
                    msg_type = content.get("msgtype", "")
                    body = content.get("body", "")
                    mxc_url = content.get("url")
                    mimetype = content.get("info", {}).get("mimetype")
                    filename = content.get("filename") or content.get("body")
                    file_size = content.get("info", {}).get("size")
                    
                    await db.execute("""
                        INSERT OR IGNORE INTO messages 
                        (event_id, room_id, sender, body, msg_type, mxc_url, mimetype, filename, file_size, timestamp, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (event_id, room_id, sender, body, msg_type, mxc_url, mimetype, filename, file_size, timestamp, datetime.utcnow().isoformat()))
                    
                    total_messages += 1
                    if mxc_url:
                        total_media += 1
                
                await db.commit()
                token = data.get("end")
                
                if len(events) < 100:
                    break
                
                logger.info(f"Backfill batch {batch}: {total_messages} messages, {total_media} media")
    
    return {
        "status": "ok",
        "room_id": room_id,
        "total_messages": total_messages,
        "total_media": total_media,
        "batches": batch,
    }


@app.post("/keys/request")
async def request_keys_for_room(room_id: str, session_id: str = None):
    """Request encryption keys for a room via to-device messages"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    import urllib.parse
    room_id_encoded = urllib.parse.quote(room_id)
    
    url = f"{HOMESERVER}/_matrix/client/v3/rooms/{room_id_encoded}/messages"
    params = {"dir": "b", "limit": 100}
    
    sessions_to_request = {}
    token = load_saved_token().get('access_token')
    
    async with aiohttp.ClientSession() as http_session:
        async with http_session.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params=params
        ) as resp:
            if resp.status != 200:
                raise HTTPException(resp.status, "Failed to fetch messages")
            
            data = await resp.json()
            for event in data.get("chunk", []):
                if event.get("type") == "m.room.encrypted":
                    content = event.get("content", {})
                    sess_id = content.get("session_id")
                    sender_key = content.get("sender_key")
                    device_id = content.get("device_id")
                    sender = event.get("sender")
                    
                    if sess_id and sender_key and (session_id is None or sess_id == session_id):
                        if sess_id not in sessions_to_request:
                            sessions_to_request[sess_id] = {
                                "sender_key": sender_key,
                                "device_id": device_id,
                                "sender": sender,
                                "algorithm": content.get("algorithm"),
                            }
        
        if not sessions_to_request:
            return {"status": "no_sessions_found", "sessions_requested": 0}
        
        request_id = str(uuid.uuid4())
        requests_sent = 0
        errors = []
        
        for sess_id, info in sessions_to_request.items():
            try:
                request_body = {
                    "action": "request",
                    "body": {
                        "algorithm": info["algorithm"] or "m.megolm.v1.aes-sha2",
                        "room_id": room_id,
                        "sender_key": info["sender_key"],
                        "session_id": sess_id,
                    },
                    "request_id": f"{request_id}_{sess_id[:10]}",
                    "requesting_device_id": matrix_client.device_id,
                }
                
                txn_id = str(uuid.uuid4())
                to_device_url = f"{HOMESERVER}/_matrix/client/v3/sendToDevice/m.room_key_request/{txn_id}"
                
                messages = {
                    matrix_client.user_id: {
                        "*": request_body
                    }
                }
                
                async with http_session.put(
                    to_device_url,
                    headers={"Authorization": f"Bearer {token}"},
                    json={"messages": messages}
                ) as send_resp:
                    if send_resp.status == 200:
                        requests_sent += 1
                        logger.info(f"Sent key request for session {sess_id[:20]}...")
                    else:
                        error = await send_resp.text()
                        errors.append(f"{sess_id[:10]}: {error[:50]}")
                        logger.warning(f"Failed to send key request: {error}")
            except Exception as e:
                errors.append(f"{sess_id[:10]}: {str(e)[:50]}")
                logger.warning(f"Key request error: {e}")
        
        result = {
            "status": "requested",
            "sessions_found": len(sessions_to_request),
            "requests_sent": requests_sent,
            "request_id": request_id,
        }
        if errors:
            result["errors"] = errors[:5]
        return result


@app.get("/keys/status")
async def keys_status():
    """Check encryption key status"""
    if not matrix_client:
        raise HTTPException(500, "Matrix client not connected")
    
    olm_info = {}
    if hasattr(matrix_client, 'olm') and matrix_client.olm:
        olm_info = {
            "account_exists": True,
            "device_keys_uploaded": True,
        }
    
    return {
        "device_id": matrix_client.device_id,
        "user_id": matrix_client.user_id,
        "encryption_enabled": True,
        "store_path": STORE_PATH,
        "olm": olm_info,
    }


@app.post("/keys/share")
async def share_keys():
    """Re-upload our device keys to server"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    try:
        resp = await matrix_client.keys_upload()
        return {
            "status": "shared",
            "response_type": type(resp).__name__,
        }
    except Exception as e:
        raise HTTPException(500, f"Key sharing failed: {str(e)}")


@app.get("/decrypt/test")
async def test_decrypt(room_id: str, limit: int = 10):
    """Test decryption of recent messages in a room"""
    if not matrix_client or not matrix_client.access_token:
        raise HTTPException(500, "Matrix client not connected")
    
    import urllib.parse
    from nio import MegolmEvent
    
    room_id_encoded = urllib.parse.quote(room_id)
    url = f"{HOMESERVER}/_matrix/client/v3/rooms/{room_id_encoded}/messages"
    params = {"dir": "b", "limit": limit}
    
    results = []
    
    async with aiohttp.ClientSession() as http_session:
        async with http_session.get(
            url,
            headers={"Authorization": f"Bearer {load_saved_token().get('access_token')}"},
            params=params
        ) as resp:
            if resp.status != 200:
                raise HTTPException(resp.status, "Failed to fetch messages")
            
            data = await resp.json()
            for event in data.get("chunk", []):
                event_type = event.get("type")
                event_id = event.get("event_id")
                
                if event_type == "m.room.encrypted":
                    content = event.get("content", {})
                    session_id = content.get("session_id", "")[:20]
                    
                    try:
                        megolm_event = MegolmEvent.from_dict(event)
                        
                        if matrix_client.olm:
                            decrypted = matrix_client.olm.decrypt_megolm_event(megolm_event, room_id)
                            if decrypted:
                                results.append({
                                    "event_id": event_id,
                                    "encrypted": True,
                                    "decrypted": True,
                                    "type": getattr(decrypted, 'source', {}).get('type', 'unknown'),
                                    "preview": str(decrypted)[:100],
                                })
                            else:
                                results.append({
                                    "event_id": event_id,
                                    "encrypted": True,
                                    "decrypted": False,
                                    "session_id": session_id,
                                    "reason": "decryption returned None",
                                })
                        else:
                            results.append({
                                "event_id": event_id,
                                "encrypted": True,
                                "decrypted": False,
                                "session_id": session_id,
                                "reason": "olm not initialized",
                            })
                    except Exception as e:
                        error_msg = str(e)
                        results.append({
                            "event_id": event_id,
                            "encrypted": True,
                            "decrypted": False,
                            "session_id": session_id,
                            "error": error_msg[:150],
                        })
                else:
                    results.append({
                        "event_id": event_id,
                        "encrypted": False,
                        "type": event_type,
                    })
    
    return {
        "room_id": room_id,
        "results": results,
    }


@app.get("/keys/sessions")
async def list_sessions(room_id: str = None):
    """List stored Megolm sessions"""
    if not matrix_client or not matrix_client.olm:
        raise HTTPException(500, "Matrix client or olm not initialized")
    
    try:
        sessions = []
        if hasattr(matrix_client.olm, 'inbound_group_store'):
            store = matrix_client.olm.inbound_group_store
            if hasattr(store, '_sessions'):
                for key, session in store._sessions.items():
                    sess_room_id, sender_key, session_id = key
                    if room_id is None or sess_room_id == room_id:
                        sessions.append({
                            "room_id": sess_room_id,
                            "session_id": session_id[:20] + "...",
                            "sender_key": sender_key[:20] + "...",
                        })
        
        return {
            "sessions_count": len(sessions),
            "sessions": sessions[:50],
        }
    except Exception as e:
        return {"error": str(e), "sessions_count": 0}


@app.get("/keys/pending")
async def pending_key_requests():
    """Check pending outgoing key requests"""
    if not matrix_client or not matrix_client.olm:
        raise HTTPException(500, "Matrix client or olm not initialized")
    
    try:
        pending = []
        if hasattr(matrix_client.olm, 'outgoing_key_requests'):
            for req in matrix_client.olm.outgoing_key_requests.values():
                pending.append({
                    "room_id": req.room_id,
                    "session_id": req.session_id[:20] + "..." if req.session_id else None,
                    "request_id": req.request_id[:20] + "..." if req.request_id else None,
                })
        
        return {
            "pending_count": len(pending),
            "pending": pending[:20],
        }
    except Exception as e:
        return {"error": str(e), "pending_count": 0}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
