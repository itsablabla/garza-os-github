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
    
    # Parse mxc URL: mxc://server/media_id
    parts = mxc_url[6:].split("/", 1)
    if len(parts) != 2:
        raise HTTPException(400, "Invalid mxc URL format")
    
    server_name, media_id = parts
    
    # Use authenticated media endpoint
    download_url = f"{HOMESERVER}/_matrix/client/v1/media/download/{server_name}/{media_id}"
    
    async with aiohttp.ClientSession() as session:
        async with session.get(
            download_url,
            headers={"Authorization": f"Bearer {matrix_client.access_token}"}
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
            headers={"Authorization": f"Bearer {matrix_client.access_token}"},
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
