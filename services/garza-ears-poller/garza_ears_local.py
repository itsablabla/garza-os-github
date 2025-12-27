#!/usr/bin/env python3
"""
Garza Ears v2 - Complete Local Processing
Polls Beeper → Transcribes (OpenAI) → Optimizes (Claude) → Saves locally
Craft upload handled by separate process via MCP
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
ANTHROPIC_API_KEY = "{{ANTHROPIC_API_KEY}}"
OPENAI_API_KEY = "{{OPENAI_API_KEY}}"

# IMPORTANT: Dedicated voice memo chats to always scan
PRIORITY_VOICE_CHATS = [
    "!hflyJyURvlrnhfldwk:beeper.com",  # Voice Messages chat (41+ memos Mar-Jun 2025)
    "!wgGHXdwZhulnzeTyyX:beeper.com",  # Jessica Voice
]

BASE_DIR = Path.home() / "garza-ears-poller"
STATE_FILE = BASE_DIR / "processed.json"
LOG_FILE = BASE_DIR / "poller.log"
AUDIO_CACHE = BASE_DIR / "cache"
TRANSCRIPT_DIR = BASE_DIR / "transcripts"
PENDING_DIR = BASE_DIR / "pending_craft"  # For Craft upload queue

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
    state["processed"] = state["processed"][-5000:]  # Keep more history
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
    """Get all messages from a chat with pagination"""
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
        
        log(f"  Page {page+1}: {len(items)} messages, total: {len(all_messages)}")
    
    return all_messages

def find_voice_memos(scan_all=False):
    voice_memos = []
    
    # First, scan priority voice chats (get ALL messages with pagination)
    for chat_id in PRIORITY_VOICE_CHATS:
        log(f"Scanning priority chat: {chat_id}")
        
        # Get chat info for title
        chat_info = beeper_api(f"/chats/{chat_id}")
        chat_title = chat_info.get("title", "Voice Messages") if chat_info else "Voice Messages"
        
        # Get ALL messages with pagination
        messages = get_chat_messages_paginated(chat_id, max_pages=20)
        log(f"  Found {len(messages)} total messages")
        
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
    
    log(f"Found {len(voice_memos)} voice memos from priority chats")
    
    # Then scan recent chats (standard behavior)
    result = beeper_api("/chats")
    if result:
        chats = result.get("items", [])[:25]
        scanned_ids = set(PRIORITY_VOICE_CHATS)
        
        for chat in chats:
            chat_id = chat.get("id", "")
            if chat_id in scanned_ids:
                continue
            scanned_ids.add(chat_id)
            
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

def transcribe_openai(audio_path):
    """Transcribe with OpenAI Whisper API"""
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    
    with open(audio_path, "rb") as f:
        audio_data = f.read()
    
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{audio_path.name}"\r\n'
        f"Content-Type: audio/ogg\r\n\r\n"
    ).encode() + audio_data + (
        f"\r\n--{boundary}\r\n"
        f'Content-Disposition: form-data; name="model"\r\n\r\n'
        f"whisper-1\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    
    conn = http.client.HTTPSConnection("api.openai.com")
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": f"multipart/form-data; boundary={boundary}"
    }
    
    try:
        conn.request("POST", "/v1/audio/transcriptions", body, headers)
        resp = conn.getresponse()
        result = json.loads(resp.read())
        conn.close()
        return result.get("text", "")
    except Exception as e:
        log(f"OpenAI Whisper failed: {e}")
        return None

def optimize_with_claude(transcript, sender, chat_title):
    """Optimize transcript with Claude"""
    prompt = f"""Clean up this voice memo transcript from {sender} in chat "{chat_title}". 
Fix any transcription errors, add proper punctuation, and format clearly.
Keep the original meaning and tone. Return only the cleaned text.

Transcript:
{transcript}"""
    
    data = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4000,
        "messages": [{"role": "user", "content": prompt}]
    }
    
    req = Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(data).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
        }
    )
    
    try:
        with urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            return result["content"][0]["text"]
    except Exception as e:
        log(f"Claude failed: {e}")
        return transcript

def process_memo(memo):
    """Full processing pipeline"""
    AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    
    ts = datetime.fromisoformat(memo["timestamp"].replace("Z", "+00:00"))
    sender = memo["sender"].replace(" ", "_")[:20]
    filename = f"{ts.strftime('%Y%m%d_%H%M%S')}_{sender}.ogg"
    audio_path = AUDIO_CACHE / filename
    
    # Download and decrypt
    log(f"Downloading {filename}...")
    audio_data = download_and_decrypt(memo["attachment"])
    if not audio_data:
        return False
    
    audio_path.write_bytes(audio_data)
    log(f"Saved {len(audio_data)} bytes")
    
    # Transcribe with OpenAI
    log("Transcribing with OpenAI Whisper...")
    transcript = transcribe_openai(audio_path)
    if not transcript:
        log("Transcription failed")
        return False
    log(f"Transcribed: {len(transcript)} chars")
    
    # Optimize with Claude
    log("Optimizing with Claude...")
    optimized = optimize_with_claude(transcript, memo["sender"], memo["chat_title"])
    log(f"Optimized: {len(optimized)} chars")
    
    # Save transcript with metadata for Craft upload
    md_content = f"""## Voice Memo - {memo['sender']}
**Chat:** {memo['chat_title']}
**Date:** {ts.strftime('%Y-%m-%d %H:%M:%S')}

### Transcript
{optimized}

---
*Raw: {transcript[:200]}...*
"""
    base_name = f"{ts.strftime('%Y%m%d_%H%M%S')}_{sender}"
    (TRANSCRIPT_DIR / f"{base_name}.md").write_text(md_content)
    log(f"Saved transcript: {base_name}.md")
    
    # Save JSON for Craft MCP upload queue
    craft_data = {
        "sender": memo["sender"],
        "chat": memo["chat_title"],
        "timestamp": memo["timestamp"],
        "optimized": optimized,
        "raw": transcript,
        "created": datetime.now().isoformat()
    }
    (PENDING_DIR / f"{base_name}.json").write_text(json.dumps(craft_data, indent=2))
    log(f"Queued for Craft: {base_name}.json")
    
    # Cleanup audio
    audio_path.unlink(missing_ok=True)
    
    return True

def poll():
    log("=" * 50)
    log("GARZA EARS v2 - Polling for voice memos")
    
    state = load_state()
    processed = set(state.get("processed", []))
    
    memos = find_voice_memos()
    log(f"Found {len(memos)} voice memos total")
    
    new_memos = [m for m in memos if m["message_id"] not in processed]
    log(f"New: {len(new_memos)}")
    
    for memo in new_memos:
        log(f"Processing: {memo['sender']} in {memo['chat_title']} @ {memo['timestamp'][:10]}")
        if process_memo(memo):
            processed.add(memo["message_id"])
            log(f"✓ Processed {memo['message_id']}")
        else:
            log(f"✗ Failed {memo['message_id']}")
        
        # Small delay between processing to avoid rate limits
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
