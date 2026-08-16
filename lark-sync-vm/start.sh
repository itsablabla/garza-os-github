#!/bin/sh
set -e

DATA_DIR=${OUTPUT_DIR:-/data/lark-sync}
MCP_PORT=${LARK_MCP_PORT:-3001}
SYNC_IN=/app/sync-in-cli.js
CONFIG_DIR=/root/.sync-in

mkdir -p "$DATA_DIR" "$CONFIG_DIR"

# ── Write Sync-in config ──────────────────────────────────────────────────────
if [ -n "$SYNCIN_URL" ] && [ -n "$SYNCIN_TOKEN" ] && [ -n "$SYNCIN_AUTH_ID" ]; then
  cat > "$CONFIG_DIR/servers.json" <<EOF
[{
  "id": 1, "name": "garzacloud", "url": "$SYNCIN_URL",
  "available": false, "allowInvalidCertificate": false,
  "authID": "$SYNCIN_AUTH_ID", "authToken": "$SYNCIN_TOKEN",
  "authTokenExpired": false, "syncScheduler": "async",
  "syncPaths": [{
    "id": 1, "name": "lark-docs",
    "localPath": "$DATA_DIR",
    "remotePath": "spaces/lark-docs/workspaces",
    "mode": "both", "enabled": true, "firstSync": false,
    "lastSync": "1970-01-01T00:00:00.000Z",
    "lastErrors": [], "mainError": null, "timestamp": 0,
    "permissions": "a:d:m:si:so", "scheduler": null,
    "diffMode": "fast", "conflictMode": "recent", "filters": []
  }]
}]
EOF
  echo "[start] Sync-in config written."
fi

# ── Start local Lark MCP ──────────────────────────────────────────────────────
echo "[start] Launching Lark MCP on 127.0.0.1:$MCP_PORT..."

MCP_ARGS="mcp -m streamable --host 127.0.0.1 -p $MCP_PORT"
if [ -n "$LARK_USER_ACCESS_TOKEN" ]; then
  MCP_ARGS="$MCP_ARGS -u $LARK_USER_ACCESS_TOKEN"
fi

APP_ID="$APP_ID" \
APP_SECRET="$APP_SECRET" \
LARK_DOMAIN="${LARK_DOMAIN:-https://open.larksuite.com}" \
  lark-mcp $MCP_ARGS &
MCP_PID=$!

# Wait up to 30s for port to open
echo "[start] Waiting for Lark MCP to be ready..."
i=0
while [ $i -lt 30 ]; do
  nc -z 127.0.0.1 "$MCP_PORT" 2>/dev/null && break
  sleep 1
  i=$((i+1))
done
nc -z 127.0.0.1 "$MCP_PORT" 2>/dev/null && \
  echo "[start] Lark MCP ready on :$MCP_PORT" || \
  echo "[start] WARNING: MCP port not open after 30s — continuing anyway"

# ── Lark fetcher (has its own setInterval loop) ───────────────────────────────
echo "[start] Starting fetch-lark.js..."
node /app/fetch-lark.js &

# ── Sync-in loop (every 60s) ──────────────────────────────────────────────────
echo "[start] Sync-in loop starting..."
while true; do
  sleep 60
  node "$SYNC_IN" run 2>&1 | tail -5 || true
done &

# Restart container if lark-mcp crashes
wait $MCP_PID
echo "[start] Lark MCP process exited — restarting container."
exit 1
