#!/usr/bin/env python3
"""
Morning Love Messages - Sends personalized morning messages to Jett, Joshua, and Julia
Runs directly on Mac with access to Beeper local API
"""

import os
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path

ANTHROPIC_API_KEY = "{{ANTHROPIC_API_KEY}}"
BEEPER_LOCAL_KEY = "3a48068b-e6df-4d9c-b39b-0e41979edaa7"
BEEPER_API = "http://localhost:23373/v0/mcp"

KIDS = {
    "Jett": {
        "chat_id": "!ayKFgXWmmnkcCYmuGd:beeper.com",
        "nickname": "stupid",
        "traits": "youngest, playful, gaming, has hamster named Hammy"
    },
    "Joshua": {
        "chat_id": "!zMNISwfEZhYcVuXnXc:beeper.com",
        "nickname": "bud",
        "traits": "son, tech-savvy"
    },
    "Julia": {
        "chat_id": "!xDDAejmyvZkLeqMJHJ:beeper.com",
        "nickname": "sweetie",
        "traits": "daughter, creative, oldest"
    }
}

JADEN_VOICE = """You are Jaden Garza sending a morning message to one of your kids. 

Your voice:
- Short, punchy (2-4 sentences max)
- Warm but not mushy
- Use: "Stack em up!", "Let's go!", "stupid" (affectionate for kids), "sweetie" (Julia)
- NO generic motivational garbage
- NO standalone "Good morning!" openers
- ONLY reference things explicitly mentioned in the chat context - never invent details about school, work, or activities
- Feel like a real dad text

Generate ONE short morning message. Just the message text."""

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def beeper_call(method: str, args: dict) -> dict:
    """Call Beeper local API"""
    import requests
    try:
        resp = requests.post(BEEPER_API,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Authorization": f"Bearer {BEEPER_LOCAL_KEY}"
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": method, "arguments": args}
            },
            timeout=30
        )
        for line in resp.text.split('\n'):
            if line.startswith('data: '):
                return json.loads(line[6:]).get("result", {})
    except Exception as e:
        log(f"Beeper error: {e}")
    return {}

def get_context(chat_id: str, kid_name: str) -> str:
    """Get recent conversation context"""
    result = beeper_call("list_messages", {"chatID": chat_id})
    content = result.get("content", [])
    
    lines = []
    for item in content:
        if item.get("type") == "text":
            text = item.get("text", "")
            try:
                data = json.loads(text) if text.startswith("{") else {"items": []}
                for msg in data.get("items", [])[:5]:
                    sender = "Jaden" if msg.get("isSender") else kid_name
                    t = msg.get("text", "")
                    if t and len(t) < 200:
                        lines.append(f"{sender}: {t}")
            except:
                pass
    
    return f"Recent with {kid_name}:\n" + "\n".join(lines) if lines else ""

def generate(kid_name: str, info: dict, context: str) -> str:
    """Generate message with Claude"""
    import requests
    
    prompt = f"""Kid: {kid_name}
Nickname: {info['nickname']}
Traits: {info['traits']}
Today: {datetime.now().strftime('%A, %B %d')}

{context or 'No recent context.'}

Write a short morning message from Jaden to {kid_name}."""

    try:
        resp = requests.post("https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 150,
                "system": JADEN_VOICE,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=30
        )
        if resp.ok:
            return resp.json()["content"][0]["text"].strip()
    except Exception as e:
        log(f"Claude error: {e}")
    return None

def send(chat_id: str, text: str) -> bool:
    """Send message via Beeper"""
    result = beeper_call("send_message", {"chatID": chat_id, "text": text})
    content = result.get("content", [])
    return any("Open the chat" in str(c) for c in content)

def main():
    log("=" * 40)
    log("Morning Love Messages")
    log("=" * 40)
    
    for kid, info in KIDS.items():
        log(f"\n--- {kid} ---")
        
        context = get_context(info["chat_id"], kid)
        log(f"Context: {len(context)} chars")
        
        msg = generate(kid, info, context)
        if not msg:
            log(f"✗ No message for {kid}")
            continue
        
        log(f"Message: {msg}")
        
        if send(info["chat_id"], msg):
            log(f"✓ Sent to {kid}")
        else:
            log(f"✗ Send failed for {kid}")
        
        time.sleep(3)
    
    log("\n" + "=" * 40)
    log("Done!")

if __name__ == "__main__":
    main()
