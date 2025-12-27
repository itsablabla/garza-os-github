#!/usr/bin/env python3
"""
Garza Ears v3 - Lightweight Poller
Polls Beeper → Sends to n8n for processing (Whisper + Claude)
Processing offloaded to GarzaHive-01
"""

import json
import os
import sys
import time
import base64
import http.client
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import unquote
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

# Configuration
BEEPER_LOCAL_TOKEN = "3a48068b-e6df-4d9c-b39b-0e41979edaa7"
BEEPER_LOCAL_URL = "http://localhost:23373"
N8N_WEBHOOK_URL = "https://n8n.garzahive.com/webhook/voice-memo"

# API keys - sent to n8n for processing
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "{{ANTHROPIC_API_KEY}}")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "{{OPENAI_API_KEY}}")

# Dedicated voice memo chats
PRIORITY_VOICE_CHATS = [
    "!hflyJyURvlrnhfldwk:beeper.com",  # Voice Messages
    "!wgGHXdwZhulnzeTyyX:beeper.com",  # Jessica Voice
]

BASE_DIR = Path.home() / "garza-ears-poller"
STATE_FILE = BASE_DIR / "processed.json"
LOG_FILE = BASE_DIR / "poller.log"
TRANSCRIPT_DIR = BASE_DIR / "transcripts"
PENDING_DIR = BASE_DIR / "pending_craft"

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
    state["processed"] = state["processed"][-5000:]
    STATE_FILE.write_text(json.dumps(state, indent=2))

def beeper_api(endpoint):
    url = f"{BEEPER_LOCAL_URL}/v1{endpoint}"
    headers = {"Authorization": f"Bearer {BEEPER_LOCAL_TOKEN}"}
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log(f"Beeper API error: {e}")
        return None

def get_chat_messages_paginated(chat_id, max_pages=10):
    all_messages = []
    cursor = None
    for page in range(max_pages):
        endpoint = f"/chats/{chat_id}/messages"
        if cursor:
            endpoint += f"?cursor={cursor}&direction=before"
        msgs = beeper_api(endpoint)
        if not msgs:
            break
        items = msgs.get("items", [])
        if not items:
            break
        all_messages.extend(items)
        cursor = msgs.get("cursor")
        if not cursor:
            break
    return all_messages

def find_voice_memos():
    voice_memos = []
    
    # Scan priority chats
    for chat_id in PRIORITY_VOICE_CHATS:
        log(f"Scanning: {chat_id[:20]}...")
        chat_info = beeper_api(f"/chats/{chat_id}")
        chat_title = chat_info.get("title", "Voice Messages") if chat_info else "Voice Messages"
        messages = get_chat_messages_paginated(chat_id, max_pages=5)
        
        for msg in messages:
            for att in msg.get("attachments", []):
                if att.get("isVoiceNote") and att.get("type") == "audio":
                    voice_memos.append({
                        "message_id": msg.get("id"),
                        "chat_id": chat_id,
                        "chat_title": chat_title,
                        "sender": msg.get("senderName", "Jaden"),
                        "timestamp": msg.get("timestamp"),
                        "attachment": att
                    })
    
    # Scan recent chats
    result = beeper_api("/chats")
    if result:
        chats = result.get("items", [])[:15]
        scanned = set(PRIORITY_VOICE_CHATS)
        
        for chat in chats:
            chat_id = chat.get("id", "")
            if chat_id in scanned:
                continue
            scanned.add(chat_id)
            
            msgs = beeper_api(f"/chats/{chat_id}/messages")
            if not msgs:
                continue
            
            for msg in msgs.get("items", []):
                for att in msg.get("attachments", []):
                    if att.get("isVoiceNote") and att.get("type") == "audio":
                        voice_memos.append({
                            "message_id": msg.get("id"),
                            "chat_id": chat_id,
                            "chat_title": chat.get("title", "Unknown"),
                            "sender": msg.get("senderName", "Unknown"),
                            "timestamp": msg.get("timestamp"),
                            "attachment": att
                        })
    
    return voice_memos

def base64url_decode(data):
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    return base64.b64decode(data.replace('-', '+').replace('_', '/'))

def download_and_decrypt(attachment):
    src_url = attachment.get("srcURL", "")
    if "encryptedFileInfoJSON=" not in src_url:
        return None
    
    parts = src_url.split("encryptedFileInfoJSON=")
    mxc_url = parts[0].rstrip("?")
    enc_b64 = unquote(parts[1])
    try:
        enc_info = json.loads(base64.b64decode(enc_b64))
    except:
        enc_info = json.loads(base64url_decode(enc_b64))
    
    if not mxc_url.startswith("mxc://"):
        return None
    
    download_url = f"https://matrix.beeper.com/_matrix/media/r0/download/{mxc_url[6:]}"
    
    try:
        with urlopen(Request(download_url), timeout=120) as resp:
            encrypted = resp.read()
    except Exception as e:
        log(f"Download failed: {e}")
        return None
    
    key = base64url_decode(enc_info["key"]["k"])
    try:
        iv = base64.b64decode(enc_info["iv"])[:16]
    except:
        iv = base64url_decode(enc_info["iv"])[:16]
    
    cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    return decryptor.update(encrypted) + decryptor.finalize()

def send_to_n8n(audio_data, memo):
    """Send audio to n8n for processing"""
    payload = {
        "audio_base64": base64.b64encode(audio_data).decode("utf-8"),
        "sender": memo["sender"],
        "chat": memo["chat_title"],
        "timestamp": memo["timestamp"],
        "message_id": memo["message_id"],
        "openai_key": OPENAI_API_KEY,
        "anthropic_key": ANTHROPIC_API_KEY
    }
    
    req = Request(
        N8N_WEBHOOK_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urlopen(req, timeout=180) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log(f"n8n error: {e}")
        return None

def process_memo(memo):
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    
    ts = datetime.fromisoformat(memo["timestamp"].replace("Z", "+00:00"))
    sender = memo["sender"].replace(" ", "_")[:20]
    base_name = f"{ts.strftime('%Y%m%d_%H%M%S')}_{sender}"
    
    # Download and decrypt
    log(f"Downloading audio...")
    audio_data = download_and_decrypt(memo["attachment"])
    if not audio_data:
        return False
    log(f"Got {len(audio_data)} bytes")
    
    # Send to n8n for processing
    log(f"Sending to n8n for processing...")
    result = send_to_n8n(audio_data, memo)
    
    if not result or not result.get("success"):
        log(f"n8n processing failed: {result}")
        return False
    
    optimized = result.get("optimized", "")
    raw = result.get("raw", "")
    log(f"Processed: {len(optimized)} chars")
    
    # Save transcript
    md_content = f"""## Voice Memo - {memo['sender']}
**Chat:** {memo['chat_title']}
**Date:** {ts.strftime('%Y-%m-%d %H:%M:%S')}

### Transcript
{optimized}

---
*Processed by Garza Ears on {datetime.now().strftime('%Y-%m-%d')}*
"""
    (TRANSCRIPT_DIR / f"{base_name}.md").write_text(md_content)
    
    # Queue for Craft
    craft_data = {
        "sender": memo["sender"],
        "chat": memo["chat_title"],
        "timestamp": memo["timestamp"],
        "optimized": optimized,
        "raw": raw,
        "created": datetime.now().isoformat()
    }
    (PENDING_DIR / f"{base_name}.json").write_text(json.dumps(craft_data, indent=2))
    log(f"✓ Saved: {base_name}")
    
    return True

def poll():
    log("=" * 50)
    log("GARZA EARS v3 - n8n Processing")
    
    state = load_state()
    processed = set(state.get("processed", []))
    
    memos = find_voice_memos()
    log(f"Found {len(memos)} voice memos")
    
    new_memos = [m for m in memos if m["message_id"] not in processed]
    log(f"New: {len(new_memos)}")
    
    for memo in new_memos:
        log(f"Processing: {memo['sender']} @ {memo['timestamp'][:10]}")
        if process_memo(memo):
            processed.add(memo["message_id"])
        time.sleep(2)
    
    state["processed"] = list(processed)
    save_state(state)
    log("Poll complete")

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "daemon":
        log("Starting daemon mode (60s interval)")
        while True:
            try:
                poll()
            except Exception as e:
                log(f"Error: {e}")
            time.sleep(60)
    else:
        poll()

if __name__ == "__main__":
    main()
