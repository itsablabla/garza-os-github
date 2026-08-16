#!/bin/sh

LOCAL_DIR=/data/lark
CONFIG_DIR=/root/.sync-in
LARK_CLI_CONFIG=/root/.larksuite/cli

mkdir -p "$LOCAL_DIR" "$CONFIG_DIR" "$LARK_CLI_CONFIG"

# ── lark-cli app config ───────────────────────────────────────────────────────
# Prefer user auth (UAT) when available — sees full personal Drive + wiki.
# Fall back to bot auth (TAT) for content shared with the Lark app.
if [ -n "$LARKSUITE_CLI_APP_ID" ] && [ -n "$LARKSUITE_CLI_APP_SECRET" ]; then
  if [ -n "$LARKSUITE_CLI_USER_ACCESS_TOKEN" ]; then
    AUTH_MODE="user"
  else
    AUTH_MODE="bot"
  fi
  cat > "$LARK_CLI_CONFIG/config.json" <<EOF
{
  "apps": [{
    "app_id": "$LARKSUITE_CLI_APP_ID",
    "app_secret": "$LARKSUITE_CLI_APP_SECRET",
    "brand": "${LARKSUITE_CLI_BRAND:-lark}",
    "default_as": "$AUTH_MODE"
  }]
}
EOF
  echo "[start] lark-cli config written (auth=$AUTH_MODE)."
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

# ── Tiny HTTP health endpoint on port 3000 ────────────────────────────────────
# Coolify needs something to curl during deploy health checks
while true; do
  echo -e 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok' | nc -l -p 3000 -q 1 2>/dev/null || true
done &

# ── Fetch tenant access token from Lark API ───────────────────────────────────
fetch_tat() {
  RESP=$(curl -s --max-time 10 -X POST \
    "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal" \
    -H "Content-Type: application/json" \
    -d "{\"app_id\":\"${LARKSUITE_CLI_APP_ID}\",\"app_secret\":\"${LARKSUITE_CLI_APP_SECRET}\"}" 2>/dev/null) || true
  TAT=$(echo "$RESP" | grep -o '"tenant_access_token":"[^"]*"' | cut -d'"' -f4) || true
  if [ -n "$TAT" ]; then
    export LARKSUITE_CLI_TENANT_ACCESS_TOKEN="$TAT"
    echo "[start] TAT refreshed (valid ~2h)."
  else
    echo "[start] WARNING: Could not fetch TAT. Response: $RESP"
  fi
}

# Only need bot TAT when not using user auth
if [ -z "$LARKSUITE_CLI_USER_ACCESS_TOKEN" ]; then
  fetch_tat
fi
TAT_FETCHED_AT=$(date +%s)

# ── Main sync loop ────────────────────────────────────────────────────────────
run_sync() {
  # Refresh TAT every 90 min (only when using bot auth)
  if [ -z "$LARKSUITE_CLI_USER_ACCESS_TOKEN" ]; then
    NOW=$(date +%s)
    if [ $((NOW - TAT_FETCHED_AT)) -gt 5400 ]; then
      fetch_tat
      TAT_FETCHED_AT=$NOW
    fi
  fi

  echo "[sync] $(date -u +%FT%TZ) Starting Lark Drive sync..."
  touch /tmp/lark-sync-alive

  cd /data
  # Resolve folder token: user auth → fetch personal My Drive root; bot → fixed shared folder
  if [ -n "$LARKSUITE_CLI_USER_ACCESS_TOKEN" ]; then
    ROOT_RESP=$(curl -s --max-time 10 \
      "https://open.larksuite.com/open-apis/drive/explorer/v2/folder/root" \
      -H "Authorization: Bearer ${LARKSUITE_CLI_USER_ACCESS_TOKEN}" 2>/dev/null) || true
    DRIVE_TOKEN=$(echo "$ROOT_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4) || true
    if [ -z "$DRIVE_TOKEN" ]; then
      echo "[sync] WARNING: Could not fetch My Drive root token, using configured folder token"
      DRIVE_TOKEN="${LARK_FOLDER_TOKEN:-nodutfN0UnUSihjoh25GdBL6BMh}"
    else
      echo "[sync] Using My Drive root token: ${DRIVE_TOKEN:0:12}..."
    fi
  else
    DRIVE_TOKEN="${LARK_FOLDER_TOKEN:-nodutfN0UnUSihjoh25GdBL6BMh}"
  fi
  lark-cli drive +sync \
    --local-dir ./lark \
    --folder-token "$DRIVE_TOKEN" \
    --quick \
    --on-conflict remote-wins \
    --on-duplicate-remote newest \
    2>&1 || echo "[sync] drive +sync exited with error"

  echo "[sync] $(date -u +%FT%TZ) Drive sync done."

  # Wiki + Bases via lark-mcp internal gateway (has auto-refreshing UAT)
  if [ -n "$LARK_MCP_URL" ]; then
    echo "[sync] Syncing Wiki and Bases via lark-mcp..."
    node /app/sync-wiki-bases.js 2>&1 || echo "[sync] wiki-bases exited with error"
    echo "[sync] Wiki/Bases sync done."
  fi

  if [ -n "$SYNCIN_URL" ]; then
    echo "[sync] Running Sync-in..."
    node /app/sync-in-cli.js run 2>&1 | tail -10 || true
    echo "[sync] Sync-in done."
  fi
}

touch /tmp/lark-sync-alive
run_sync

while true; do
  touch /tmp/lark-sync-alive
  sleep "${SYNC_INTERVAL_SECONDS:-900}"
  run_sync
done
