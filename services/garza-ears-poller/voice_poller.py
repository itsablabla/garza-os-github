#!/usr/bin/env python3
"""
Garza Ears Voice Poller v2 - Mac Component
Polls Beeper for voice memos and sends to GarzaHive for processing
"""

import json
import os
import subprocess
import sys
import time
import base64
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

# Configuration
BEEPER_LOCAL_TOKEN = "3a48068b-e6df-4d9c-b39b-0e41979edaa7"
BEEPER_LOCAL_URL = "http://localhost:23373"
GARZAHIVE_HOST = "root@159.89.232.130"
GARZAHIVE_QUEUE = "/home/claude/voice-memo-watcher/queue"
STATE_FILE = Path.home() / "garza-ears-poller" / "processed.json"
LOG_FILE = Path.home() / "garza-ears-poller" / "poller.log"
AUDIO_CACHE = Path.home() / "garza-ears-poller" / "cache"

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"processed": [], "last_poll": None}

def save_state(state):
    state["last_poll"] = datetime.now().isoformat()
    state["processed"] = state["processed"][-1000:]
    STATE_FILE.write_text(json.dumps(state, indent=2))

def beeper_api(endpoint, method="GET", data=None):
    url = f"{BEEPER_LOCAL_URL}/v1{endpoint}"
    headers = {
        "Authorization": f"Bearer {BEEPER_LOCAL_TOKEN}",
        "Content-Type": "application/json"
    }
    req = Request(url, headers=headers, method=method)
    if data:
        req.data = json.dumps(data).encode()
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        log(f"API error {e.code}: {e.read().decode()}")
        return None
    except URLError as e:
        log(f"Connection error: {e}")
        return None

def get_recent_chats():
    result = beeper_api("/chats")
    if result and "items" in result:
        return result["items"]
    return []

def get_chat_messages(chat_id):
    result = beeper_api(f"/chats/{chat_id}/messages")
    if result and "items" in result:
        return result["items"]
    return []

def find_voice_memos():
    voice_memos = []
    chats = get_recent_chats()
    log(f"Scanning {len(chats)} chats for voice memos...")
    
    for chat in chats[:30]:
        chat_id = chat.get("id", "")
        messages = get_chat_messages(chat_id)
        
        for msg in messages:
            attachments = msg.get("attachments", [])
            for att in attachments:
                if att.get("isVoiceNote") and att.get("type") == "audio":
                    voice_memos.append({
                        "message_id": msg.get("id"),
                        "chat_id": chat_id,
                        "chat_title": chat.get("title", "Unknown"),
                        "sender": msg.get("senderName", "Unknown"),
                        "sender_id": msg.get("senderID", ""),
                        "timestamp": msg.get("timestamp"),
                        "attachment": att
                    })
    return voice_memos

def base64url_decode(data):
    """Decode base64url (URL-safe base64 without padding)"""
    # Add padding if needed
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    # Replace URL-safe chars
    data = data.replace('-', '+').replace('_', '/')
    return base64.b64decode(data)

def decrypt_media(encrypted_data, enc_info):
    """Decrypt Matrix encrypted media using AES-256-CTR"""
    # Get key (base64url encoded, 32 bytes for AES-256)
    key_b64url = enc_info["key"]["k"]
    key = base64url_decode(key_b64url)
    
    # Get IV (base64 standard, 16 bytes for CTR)
    iv_b64 = enc_info["iv"]
    # Handle both standard and URL-safe base64
    try:
        iv = base64.b64decode(iv_b64)
    except:
        iv = base64url_decode(iv_b64)
    iv = iv[:16]  # CTR needs exactly 16 bytes
    
    # Create AES-CTR cipher
    cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    
    # Decrypt
    decrypted = decryptor.update(encrypted_data) + decryptor.finalize()
    
    return decrypted

def download_and_decrypt(attachment):
    src_url = attachment.get("srcURL", "")
    if not src_url:
        return None
    
    # Parse the mxc URL and encryption info
    if "encryptedFileInfoJSON=" in src_url:
        parts = src_url.split("encryptedFileInfoJSON=")
        mxc_url = parts[0].rstrip("?")
        enc_info_b64 = unquote(parts[1])  # URL decode
        try:
            enc_info = json.loads(base64.b64decode(enc_info_b64))
        except:
            enc_info = json.loads(base64url_decode(enc_info_b64))
    else:
        log("No encryption info found")
        return None
    
    # Convert mxc:// to https://
    if mxc_url.startswith("mxc://"):
        mxc_path = mxc_url[6:]
        download_url = f"https://matrix.beeper.com/_matrix/media/r0/download/{mxc_path}"
    else:
        log(f"Invalid mxc URL: {mxc_url}")
        return None
    
    # Download encrypted media
    log(f"Downloading from {download_url[:80]}...")
    try:
        req = Request(download_url)
        with urlopen(req, timeout=60) as resp:
            encrypted_data = resp.read()
        log(f"Downloaded {len(encrypted_data)} bytes")
    except Exception as e:
        log(f"Download failed: {e}")
        return None
    
    # Decrypt
    try:
        decrypted = decrypt_media(encrypted_data, enc_info)
        log(f"Decrypted to {len(decrypted)} bytes")
        return decrypted
    except Exception as e:
        log(f"Decryption failed: {e}")
        import traceback
        log(traceback.format_exc())
        return None

def transfer_to_garzahive(audio_data, memo_info):
    AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
    
    ts = datetime.fromisoformat(memo_info["timestamp"].replace("Z", "+00:00"))
    sender = memo_info["sender"].replace(" ", "_").replace("/", "-")[:20]
    filename = f"{ts.strftime('%Y%m%d_%H%M%S')}_{sender}.ogg"
    
    local_audio = AUDIO_CACHE / filename
    local_meta = AUDIO_CACHE / f"{filename}.json"
    
    local_audio.write_bytes(audio_data)
    local_meta.write_text(json.dumps({
        "message_id": memo_info["message_id"],
        "chat_id": memo_info["chat_id"],
        "chat_title": memo_info["chat_title"],
        "sender": memo_info["sender"],
        "sender_id": memo_info["sender_id"],
        "timestamp": memo_info["timestamp"],
        "filename": filename,
        "file_size": len(audio_data)
    }, indent=2))
    
    log(f"Transferring {filename} to GarzaHive...")
    try:
        subprocess.run(
            ["scp", str(local_audio), f"{GARZAHIVE_HOST}:{GARZAHIVE_QUEUE}/"],
            check=True, capture_output=True, timeout=60
        )
        subprocess.run(
            ["scp", str(local_meta), f"{GARZAHIVE_HOST}:{GARZAHIVE_QUEUE}/"],
            check=True, capture_output=True, timeout=60
        )
        log(f"Transferred {filename}")
        
        log("Triggering GarzaHive processing...")
        subprocess.run(
            ["ssh", GARZAHIVE_HOST, "cd /home/claude/voice-memo-watcher && python3 garza_ears.py queue"],
            capture_output=True, timeout=120
        )
        
        local_audio.unlink()
        local_meta.unlink()
        return True
    except subprocess.SubprocessError as e:
        log(f"Transfer failed: {e}")
        return False

def poll():
    log("=" * 50)
    log("GARZA EARS POLLER - Checking for voice memos")
    
    state = load_state()
    processed = set(state.get("processed", []))
    
    memos = find_voice_memos()
    log(f"Found {len(memos)} voice memos total")
    
    new_memos = [m for m in memos if m["message_id"] not in processed]
    log(f"New unprocessed: {len(new_memos)}")
    
    for memo in new_memos:
        log(f"Processing memo from {memo['sender']} in {memo['chat_title']}")
        
        audio_data = download_and_decrypt(memo["attachment"])
        if audio_data:
            if transfer_to_garzahive(audio_data, memo):
                processed.add(memo["message_id"])
                log(f"Successfully processed {memo['message_id']}")
            else:
                log(f"Failed to transfer {memo['message_id']}")
        else:
            log(f"Failed to download/decrypt {memo['message_id']}")
    
    state["processed"] = list(processed)
    save_state(state)
    log("Poll complete")
    log("=" * 50)

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "daemon":
        log("Starting daemon mode (60s interval)")
        while True:
            try:
                poll()
            except Exception as e:
                log(f"Poll error: {e}")
            time.sleep(60)
    else:
        poll()

if __name__ == "__main__":
    main()
