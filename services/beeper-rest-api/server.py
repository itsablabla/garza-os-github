#!/usr/bin/env python3
"""Beeper REST Bridge - Proxies to Beeper Local API v1"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.request
import urllib.error
import os

BEEPER_BASE = "http://localhost:23373/v1"
BEEPER_TOKEN = "3a48068b-e6df-4d9c-b39b-0e41979edaa7"
API_KEY = os.environ.get("BEEPER_BRIDGE_KEY", "garza-beeper-2024")
PORT = 8765

class BeeperBridge(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _check_auth(self):
        auth = self.headers.get("X-API-Key", "")
        if auth != API_KEY:
            self._send_json({"error": "Unauthorized"}, 401)
            return False
        return True

    def _beeper_request(self, path, method="GET", data=None):
        url = f"{BEEPER_BASE}{path}"
        headers = {
            "Authorization": f"Bearer {BEEPER_TOKEN}",
            "Content-Type": "application/json"
        }
        req = urllib.request.Request(url, headers=headers, method=method)
        if data:
            req.data = json.dumps(data).encode()
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            return {"error": str(e), "status": e.code}
        except Exception as e:
            return {"error": str(e)}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-API-Key, Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"status": "ok", "service": "beeper-bridge"})
            return

        if not self._check_auth():
            return

        # GET /chats - list chats
        if self.path == "/chats" or self.path.startswith("/chats?"):
            result = self._beeper_request("/chats")
            self._send_json(result)
            return

        # GET /chats/<id> - get chat details
        if self.path.startswith("/chats/") and "/messages" not in self.path:
            chat_id = self.path.split("/chats/")[1].split("?")[0]
            result = self._beeper_request(f"/chats/{chat_id}")
            self._send_json(result)
            return

        # GET /chats/<id>/messages - list messages
        if "/messages" in self.path:
            parts = self.path.split("/chats/")[1]
            chat_id = parts.split("/messages")[0]
            result = self._beeper_request(f"/chats/{chat_id}/messages")
            self._send_json(result)
            return

        # GET /accounts - list accounts
        if self.path == "/accounts":
            result = self._beeper_request("/accounts")
            self._send_json(result)
            return

        self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        if not self._check_auth():
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length).decode()) if content_length > 0 else {}

        # POST /chats/search - search chats
        if self.path == "/chats/search":
            result = self._beeper_request("/chats/search", "POST", body)
            self._send_json(result)
            return

        # POST /messages/search - search messages
        if self.path == "/messages/search":
            result = self._beeper_request("/messages/search", "POST", body)
            self._send_json(result)
            return

        # POST /chats/<id>/messages - send message
        if self.path.startswith("/chats/") and self.path.endswith("/messages"):
            chat_id = self.path.split("/chats/")[1].split("/messages")[0]
            result = self._beeper_request(f"/chats/{chat_id}/messages", "POST", body)
            self._send_json(result)
            return

        self._send_json({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        print(f"[BeeperBridge] {args[0]}")

if __name__ == "__main__":
    print(f"Beeper REST Bridge starting on port {PORT}...")
    server = HTTPServer(("0.0.0.0", PORT), BeeperBridge)
    server.serve_forever()
