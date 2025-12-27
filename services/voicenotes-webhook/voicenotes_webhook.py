#!/usr/bin/env python3
"""
VoiceNotes Webhook Receiver for GARZA OS
Deployed on Fly.io - receives webhooks and stores voicenotes

Webhook URL: https://voicenotes-garza.fly.dev/webhook/voicenotes
"""

import os
import json
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

SAVE_TO_FILE = os.environ.get("SAVE_TO_FILE", "true").lower() == "true"
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/data/voicenotes")

if SAVE_TO_FILE:
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def sanitize_filename(name: str) -> str:
    return "".join(c if c.isalnum() or c in " -_" else "_" for c in name)[:50].strip()


def voicenote_to_markdown(data: dict) -> str:
    note = data.get("data", {})
    event = data.get("event", "")
    timestamp = data.get("timestamp", datetime.now().isoformat())
    
    lines = []
    title = note.get("title") or "Untitled Voice Note"
    lines.append(f"# {title}\n")
    lines.append(f"**Captured:** {timestamp}")
    lines.append(f"**Event:** {event}")
    lines.append(f"**ID:** {note.get('id', 'N/A')}\n")
    
    transcript = note.get("transcript") or note.get("text") or ""
    if transcript:
        lines.append("## Transcript\n")
        lines.append(transcript)
        lines.append("")
    
    summary = note.get("summary")
    if summary:
        lines.append("## Summary\n")
        lines.append(summary)
        lines.append("")
    
    todos = note.get("todos") or note.get("action_items") or []
    if todos:
        lines.append("## Action Items\n")
        for todo in todos:
            text = todo if isinstance(todo, str) else todo.get('text', str(todo))
            lines.append(f"- [ ] {text}")
        lines.append("")
    
    points = note.get("main_points") or note.get("mainpoints") or []
    if points:
        lines.append("## Key Points\n")
        for point in points:
            text = point if isinstance(point, str) else point.get('text', str(point))
            lines.append(f"- {text}")
        lines.append("")
    
    tags = note.get("tags") or []
    if tags:
        lines.append(f"\n---\n{' '.join(f'#{t}' for t in tags)}\n")
    
    return "\n".join(lines)


def save_note(data: dict, event: str) -> str:
    note_data = data.get("data", {})
    note_id = note_data.get("id", "unknown")[:8]
    title = sanitize_filename(note_data.get("title", "Untitled"))
    timestamp = data.get("timestamp", datetime.now().isoformat())
    date_str = timestamp[:10] if len(timestamp) >= 10 else datetime.now().strftime("%Y-%m-%d")
    
    filename = f"{date_str}_{title}_{note_id}"
    
    json_path = os.path.join(OUTPUT_DIR, f"{filename}.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    md_path = os.path.join(OUTPUT_DIR, f"{filename}.md")
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(voicenote_to_markdown(data))
    
    log_path = os.path.join(OUTPUT_DIR, "webhook.log")
    with open(log_path, 'a') as f:
        f.write(f"{datetime.now().isoformat()} | {event} | {title} | {note_id}\n")
    
    return filename


@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": "VoiceNotes Webhook for GARZA OS",
        "webhook_url": "/webhook/voicenotes",
        "health": "/health",
        "notes": "/notes"
    })


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "service": "voicenotes-webhook",
        "timestamp": datetime.now().isoformat()
    })


@app.route('/webhook/voicenotes', methods=['POST'])
def voicenotes_webhook():
    try:
        data = request.json
        event = data.get("event", "unknown")
        
        print(f"Webhook received: {event}")
        
        if event in ["recording.created", "recording.updated", "summary.created", 
                     "todo.created", "mainpoints.created"]:
            if SAVE_TO_FILE:
                filename = save_note(data, event)
                print(f"Saved: {filename}")
            
            return jsonify({"status": "success", "event": event}), 200
            
        elif event == "recording.deleted":
            print(f"Note deleted: {data.get('data', {}).get('id')}")
            return jsonify({"status": "logged", "event": event}), 200
            
        else:
            print(f"Unknown event: {event}")
            return jsonify({"status": "received", "event": event}), 200
            
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/notes', methods=['GET'])
def list_notes():
    notes = []
    try:
        for filename in sorted(os.listdir(OUTPUT_DIR), reverse=True):
            if filename.endswith('.json'):
                filepath = os.path.join(OUTPUT_DIR, filename)
                with open(filepath) as f:
                    data = json.load(f)
                    notes.append({
                        "filename": filename,
                        "title": data.get("data", {}).get("title"),
                        "timestamp": data.get("timestamp"),
                        "event": data.get("event")
                    })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    return jsonify({"count": len(notes), "notes": notes[:50]})


@app.route('/notes/<note_id>', methods=['GET'])
def get_note(note_id):
    try:
        for filename in os.listdir(OUTPUT_DIR):
            if filename.endswith('.json') and note_id in filename:
                with open(os.path.join(OUTPUT_DIR, filename)) as f:
                    return jsonify(json.load(f))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    return jsonify({"error": "Note not found"}), 404


@app.route('/notes/<note_id>/markdown', methods=['GET'])
def get_note_markdown(note_id):
    try:
        for filename in os.listdir(OUTPUT_DIR):
            if filename.endswith('.md') and note_id in filename:
                with open(os.path.join(OUTPUT_DIR, filename)) as f:
                    return f.read(), 200, {'Content-Type': 'text/markdown'}
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    return jsonify({"error": "Note not found"}), 404


@app.route('/export', methods=['GET'])
def export_all():
    notes = []
    try:
        for filename in sorted(os.listdir(OUTPUT_DIR)):
            if filename.endswith('.json'):
                with open(os.path.join(OUTPUT_DIR, filename)) as f:
                    notes.append(json.load(f))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    return jsonify(notes)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f"VoiceNotes Webhook starting on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
