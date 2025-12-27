# Beeper Fast MCP

High-performance Matrix/Beeper message sync daemon with FastAPI REST interface.

## Architecture

- **matrix-nio daemon** maintaining persistent Matrix connection to Beeper homeserver
- **SQLite database** for local message storage and search
- **FastAPI REST API** for querying messages, rooms, and media
- **E2E encryption support** with key request functionality

## Deployment

Deployed on Fly.io with persistent volume for database and crypto store.

```bash
# Deploy
fly deploy

# Check status
curl https://beeper-fast-mcp.fly.dev/health
```

## API Endpoints

### Core
- `GET /health` - Health check
- `GET /rooms` - List synced rooms
- `GET /rooms/{room_id}/messages` - Get room messages
- `GET /search?q=...` - Search messages
- `POST /send` - Send message

### Media
- `GET /media` - List media messages (voice memos, files)
- `GET /media/download?mxc_url=...` - Download media file

### Backfill
- `GET /backfill?room_id=...&limit=N` - Fetch historical messages
- `GET /backfill/all?room_id=...&max_messages=N` - Deep backfill with pagination

### Encryption Keys
- `POST /keys/request?room_id=...` - Request missing session keys
- `GET /keys/status` - Check encryption status
- `GET /keys/sessions` - List stored Megolm sessions
- `GET /keys/pending` - Check pending key requests
- `GET /decrypt/test?room_id=...` - Test decryption capability

## E2E Encryption Notes

- ✅ Works for **new messages** (device verified, keys shared going forward)
- ❌ **Historical encrypted messages** require key sharing from other devices
- Key requests are sent via `m.room_key_request` to-device messages
- Most Matrix clients don't auto-share historical keys for security reasons

## Environment Variables

```bash
MATRIX_HOMESERVER=https://matrix.beeper.com
MATRIX_USER_ID=@username:beeper.com
MATRIX_PASSWORD=xxx
```

## Files

- `main.py` - FastAPI application with Matrix sync daemon
- `Dockerfile` - Container image with libolm
- `fly.toml` - Fly.io deployment config
- `requirements.txt` - Python dependencies
