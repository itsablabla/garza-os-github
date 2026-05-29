#!/usr/bin/env bash
# tg-status.sh — maintain ONE live status message in the Telegram chat,
# editing it in place each call so the chat doesn't get flooded.
#
# Usage:
#   tg-status.sh "🤔 Planning…"
#   tg-status.sh "🔧 Reading src/server.ts"
#   tg-status.sh "🧪 Running tests"
#
# Conventions (suggested):
#   🤔 thinking / planning
#   🔧 tool call: file read/write, shell, gh, curl
#   🧪 running tests / build
#   🌐 network call
#   ✅ phase complete / final result (use tg-reply.sh for the FINAL message
#       you want to persist; reserve tg-status.sh for the live status line.)
#
# Behaviour:
#   First call → sendMessage, stash message_id in /tmp/tg-status-mid.
#   Later calls → editMessageText that same message in place.
#   Falls back to sendMessage if the edit fails (message too old, etc.).

set -euo pipefail

TG_TARGET_FILE="${TG_TARGET_FILE:-/tmp/tg-target}"
STATUS_MID_FILE="${STATUS_MID_FILE:-/tmp/tg-status-mid}"
MAX_LEN=4000

err() { echo "[tg-status] $*" >&2; }

if [[ -z "${TG_BOT_TOKEN:-}" ]]; then
  err "TG_BOT_TOKEN unset"
  exit 2
fi

if [[ $# -lt 1 ]]; then
  err "usage: tg-status.sh <text> | tg-status.sh -"
  exit 1
fi

if [[ "$1" == "-" ]]; then
  TEXT=$(cat)
else
  TEXT="$*"
fi

# Resolve target chat.
if [[ -n "${TG_CHAT_ID:-}" ]]; then
  CHAT_ID="$TG_CHAT_ID"
  THREAD_ID="${TG_THREAD_ID:-}"
elif [[ -f "$TG_TARGET_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$TG_TARGET_FILE"
  CHAT_ID="${TG_CHAT_ID:-}"
  THREAD_ID="${TG_THREAD_ID:-}"
fi

if [[ -z "${CHAT_ID:-}" ]]; then
  err "no chat target; run tg-target-detect.sh first or export TG_CHAT_ID"
  exit 3
fi

# Truncate to fit Telegram's text cap with headroom.
TEXT="${TEXT:0:$MAX_LEN}"

# Edit in place if we already have a message id.
if [[ -f "$STATUS_MID_FILE" ]]; then
  MID=$(cat "$STATUS_MID_FILE")
  RESP=$(curl -sS -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/editMessageText" \
    --data-urlencode "chat_id=$CHAT_ID" \
    --data-urlencode "message_id=$MID" \
    --data-urlencode "text=$TEXT" 2>/dev/null || echo '{"ok":false}')
  if echo "$RESP" | grep -q '"ok":true'; then
    exit 0
  fi
  # "message is not modified" → identical body, treat as success.
  if echo "$RESP" | grep -q "message is not modified"; then
    exit 0
  fi
  # Otherwise the edit failed (message too old, deleted, etc.) — fall
  # through to send a fresh status message.
fi

# Send a new status message and stash its id.
ARGS=(--data-urlencode "chat_id=$CHAT_ID" --data-urlencode "text=$TEXT")
[[ -n "${THREAD_ID:-}" ]] && ARGS+=(--data-urlencode "message_thread_id=$THREAD_ID")
RESP=$(curl -sS -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" "${ARGS[@]}")
NEW_MID=$(echo "$RESP" | grep -oE '"message_id":[0-9]+' | head -1 | cut -d: -f2)
if [[ -n "$NEW_MID" ]]; then
  echo "$NEW_MID" > "$STATUS_MID_FILE"
  exit 0
fi

err "sendMessage failed: $(echo "$RESP" | head -c 200)"
exit 1
