#!/bin/sh
set -e

SYNC_IN=/app/sync-in-cli.js
CONFIG_DIR=/root/.sync-in
DATA_DIR=${OUTPUT_DIR:-/data/lark-sync}

mkdir -p "$DATA_DIR"
mkdir -p "$CONFIG_DIR"

# Write sync-in server config if env vars are set
if [ -n "$SYNCIN_URL" ] && [ -n "$SYNCIN_TOKEN" ] && [ -n "$SYNCIN_AUTH_ID" ]; then
  cat > "$CONFIG_DIR/servers.json" <<EOF
[
  {
    "id": 1,
    "name": "garzacloud",
    "url": "$SYNCIN_URL",
    "available": false,
    "allowInvalidCertificate": false,
    "authID": "$SYNCIN_AUTH_ID",
    "authToken": "$SYNCIN_TOKEN",
    "authTokenExpired": false,
    "syncScheduler": "async",
    "syncPaths": [
      {
        "id": 1,
        "name": "lark-docs",
        "localPath": "$DATA_DIR",
        "remotePath": "spaces/lark-docs/workspaces",
        "mode": "both",
        "enabled": true,
        "firstSync": false,
        "lastSync": "1970-01-01T00:00:00.000Z",
        "lastErrors": [],
        "mainError": null,
        "timestamp": 0,
        "permissions": "a:d:m:si:so",
        "scheduler": null,
        "diffMode": "fast",
        "conflictMode": "recent",
        "filters": []
      }
    ]
  }
]
EOF
fi

# Run initial Lark fetch, then sync-in, then loop
echo "[start] Initial Lark fetch..."
node /app/fetch-lark.js &
FETCH_PID=$!

# Run sync-in in background on a schedule
while true; do
  sleep 60
  node "$SYNC_IN" run 2>&1 | tail -5
done &

wait $FETCH_PID
echo "[start] Container running. Lark fetch + Sync-in active."

# Keep alive
wait
