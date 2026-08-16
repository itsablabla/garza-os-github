#!/bin/sh
set -e

LOCAL_DIR=/data/lark
CONFIG_DIR=/root/.sync-in

mkdir -p "$LOCAL_DIR" "$CONFIG_DIR"

# ── Sync-in config ────────────────────────────────────────────────────────────
if [ -n "$SYNCIN_URL" ] && [ -n "$SYNCIN_TOKEN" ] && [ -n "$SYNCIN_AUTH_ID" ]; then
  cat > "$CONFIG_DIR/servers.json" <<EOF
[{
  "id": 1, "name": "garzacloud", "url": "$SYNCIN_URL",
  "available": false, "allowInvalidCertificate": false,
  "authID": "$SYNCIN_AUTH_ID", "authToken": "$SYNCIN_TOKEN",
  "authTokenExpired": false, "syncScheduler": "async",
  "syncPaths": [{
    "id": 1, "name": "lark-docs",
    "localPath": "$LOCAL_DIR",
    "remotePath": "${SYNCIN_REMOTE_PATH:-spaces/lark-docs/workspaces}",
    "mode": "both", "enabled": true, "firstSync": false,
    "lastSync": "1970-01-01T00:00:00.000Z",
    "lastErrors": [], "mainError": null, "timestamp": 0,
    "permissions": "a:d:m:si:so", "scheduler": null,
    "diffMode": "fast", "conflictMode": "recent", "filters": []
  }]
}]
EOF
  echo "[start] Sync-in config written → $SYNCIN_URL"
fi

# ── Main sync loop ────────────────────────────────────────────────────────────
run_sync() {
  echo "[sync] $(date -u +%FT%TZ) Starting Lark Drive sync..."

  # lark-cli requires --local-dir to be relative to cwd
  cd /data
  lark-cli drive +sync \
    --local-dir ./lark \
    --folder-token "${LARK_FOLDER_TOKEN:-nodutfN0UnUSihjoh25GdBL6BMh}" \
    --quick \
    --on-conflict remote-wins \
    --on-duplicate-remote newest \
    2>&1 || echo "[sync] drive +sync exited with error"

  echo "[sync] $(date -u +%FT%TZ) Drive sync done."

  if [ -n "$SYNCIN_URL" ]; then
    echo "[sync] Running Sync-in..."
    node /app/sync-in-cli.js run 2>&1 | tail -10 || true
    echo "[sync] Sync-in done."
  fi
}

# ── Healthcheck state ─────────────────────────────────────────────────────────
touch /tmp/lark-sync-alive

run_sync

while true; do
  touch /tmp/lark-sync-alive
  sleep "${SYNC_INTERVAL_SECONDS:-900}"
  run_sync
done
