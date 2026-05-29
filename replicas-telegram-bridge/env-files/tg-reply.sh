#!/usr/bin/env bash
# tg-reply.sh — agent helper for posting messages back to a Telegram chat
# that triggered the spawn. Reads target chat from /tmp/tg-target (cached) or
# from the chat header in the agent's initial prompt.
#
# Usage:
#   tg-reply.sh "your message text"
#   echo "long text" | tg-reply.sh -
#
# Requires:
#   TG_BOT_TOKEN  — set globally on the env (already configured for this org)
#
# The Telegram-bridge Worker prefixes every Replicas spawn's initial prompt with
#   [tg:chat_id=<id>] or [tg:chat_id=<id>:thread_id=<id>]
# Pick that up from the agent's conversation history (or set TG_TARGET_FILE
# upstream if your wrapper has already parsed it).

set -euo pipefail

TG_TARGET_FILE="${TG_TARGET_FILE:-/tmp/tg-target}"
MAX_LEN=4000

err() { echo "[tg-reply] $*" >&2; }

if [[ -z "${TG_BOT_TOKEN:-}" ]]; then
  err "TG_BOT_TOKEN is unset — can't reach Telegram."
  exit 2
fi

# Read message either from $1 or, if $1 == "-", from stdin.
if [[ $# -lt 1 ]]; then
  err "usage: tg-reply.sh <text> | tg-reply.sh -"
  exit 1
fi
if [[ "$1" == "-" ]]; then
  MSG=$(cat)
else
  MSG="$*"
fi

# Resolve the target chat. Pre-cached or env-overridden wins.
if [[ -n "${TG_CHAT_ID:-}" ]]; then
  CHAT_ID="$TG_CHAT_ID"
  THREAD_ID="${TG_THREAD_ID:-}"
elif [[ -f "$TG_TARGET_FILE" ]]; then
  # File format: KEY=VALUE lines.
  # shellcheck disable=SC1090
  source "$TG_TARGET_FILE"
  CHAT_ID="${TG_CHAT_ID:-}"
  THREAD_ID="${TG_THREAD_ID:-}"
else
  err "No TG_CHAT_ID and no $TG_TARGET_FILE. Run tg-target-detect.sh once first, or export TG_CHAT_ID."
  exit 3
fi

if [[ -z "${CHAT_ID:-}" ]]; then
  err "Couldn't resolve a Telegram chat to reply to."
  exit 3
fi

# Telegram caps sendMessage body at 4096 chars. Chunk safely.
chunk() {
  local text="$1"
  while [[ ${#text} -gt 0 ]]; do
    printf '%s\n' "${text:0:$MAX_LEN}"
    text="${text:$MAX_LEN}"
  done
}

send_one() {
  local body="$1"
  local args=(--data-urlencode "chat_id=$CHAT_ID" --data-urlencode "text=$body")
  if [[ -n "${THREAD_ID:-}" ]]; then
    args+=(--data-urlencode "message_thread_id=$THREAD_ID")
  fi
  curl -sS -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" "${args[@]}" \
    | grep -q '"ok":true' || {
      err "sendMessage failed"
      return 1
    }
}

while IFS= read -r piece; do
  send_one "$piece"
done < <(chunk "$MSG")
