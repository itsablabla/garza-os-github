#!/bin/sh
set -e

LOCAL_DIR=/data/lark
CONFIG_DIR=/root/.sync-in
LARK_CLI_CONFIG=/root/.larksuite/cli

mkdir -p "$LOCAL_DIR" "$CONFIG_DIR" "$LARK_CLI_CONFIG"

# ── lark-cli app config (needed for tenant access token exchange) ─────────────
if [ -n "$LARKSUITE_CLI_APP_ID" ] && [ -n "$LARKSUITE_CLI_APP_SECRET" ]; then
  cat > "$LARK_CLI_CONFIG/config.json" <<EOF
{
  "apps": [{
    "app_id": "$LARKSUITE_CLI_APP_ID",
    "app_secret": "$LARKSUITE_CLI_APP_SECRET",
    "brand": "${LARKSUITE_CLI_BRAND:-lark}",
    "default_as": "${LARKSUITE_CLI_DEFAULT_AS:-bot}"
  }]
}
EOF
  echo "[start] lark-cli config written."
fi

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

# ── Fetch fresh tenant access token ──────────────────────────────────────────
fetch_tat() {
  RESP=$(curl -s -X POST "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\":\"$LARKSUITE_CLI_APP_ID\",\"app_secret\":\"$LARKSUITE_CLI_APP_SECRET\"}")
  TAT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tenant_access_token',''))" 2>/dev/null)
  if [ -n "$TAT" ]; then
    export LARKSUITE_CLI_TENANT_ACCESS_TOKEN="$TAT"
    export LARKSUITE_CLI_DEFAULT_AS="bot"
    echo "[start] Tenant access token refreshed (expires in $(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('expire',0))" 2>/dev/null)s)."
  else
    echo "[start] WARNING: Failed to fetch tenant access token: $RESP"
  fi
}

fetch_tat
TAT_FETCHED_AT=$(date +%s)

# ── Main sync loop ────────────────────────────────────────────────────────────
run_sync() {
  # Refresh TAT if older than 90 minutes
  NOW=$(date +%s)
  if [ $((NOW - TAT_FETCHED_AT)) -gt 5400 ]; then
    fetch_tat
    TAT_FETCHED_AT=$NOW
  fi

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
