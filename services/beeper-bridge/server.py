#!/usr/bin/env python3
"""
Beeper Bridge - HTTP API for sending Beeper messages
Runs on Mac, accessible via Cloudflare Tunnel
"""

import os
import json
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 23380

class BeeperHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[Beeper Bridge] {args[0]}")
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_GET(self):
        if self.path == '/health':
            self.send_json({'status': 'ok', 'service': 'beeper-bridge'})
        else:
            self.send_json({'error': 'Not found'}, 404)
    
    def do_POST(self):
        if self.path == '/send':
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))
            
            chat_id = body.get('chat_id')
            text = body.get('text')
            
            if not chat_id or not text:
                self.send_json({'error': 'Missing chat_id or text'}, 400)
                return
            
            try:
                # Use osascript to send via Beeper Desktop's AppleScript support
                # Or call the mcp-server-beeper CLI
                result = send_beeper_message(chat_id, text)
                self.send_json({'success': True, 'result': result})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
        else:
            self.send_json({'error': 'Not found'}, 404)

def send_beeper_message(chat_id, text):
    """Send message using curl to Beeper Local API"""
    import urllib.parse
    encoded_chat_id = urllib.parse.quote(chat_id, safe='')
    
    # Try different endpoint patterns
    endpoints = [
        f"http://localhost:23373/api/v1/chats/{encoded_chat_id}/messages",
        f"http://localhost:23373/api/v1/rooms/{encoded_chat_id}/messages",
    ]
    
    for url in endpoints:
        result = subprocess.run([
            'curl', '-s', '-X', 'POST', url,
            '-H', 'Content-Type: application/json',
            '-d', json.dumps({'text': text}),
            '--max-time', '10'
        ], capture_output=True, text=True)
        
        if result.returncode == 0 and 'error' not in result.stdout.lower():
            return {'endpoint': url, 'response': result.stdout[:200]}
    
    # If all fail, return the last error
    return {'error': 'All endpoints failed', 'last_response': result.stdout[:200]}

if __name__ == '__main__':
    print(f"Starting Beeper Bridge on port {PORT}")
    server = HTTPServer(('0.0.0.0', PORT), BeeperHandler)
    server.serve_forever()
