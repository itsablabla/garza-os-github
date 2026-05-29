#!/usr/bin/env bash
# tg-target-detect.sh — extract the Telegram chat_id / thread_id from the
# agent's initial prompt and stash them in $TG_TARGET_FILE so subsequent
# tg-reply.sh calls don't need arguments.
#
# Usage:
#   echo "$INITIAL_PROMPT" | tg-target-detect.sh
#   tg-target-detect.sh < /path/to/prompt.txt
#
# Output file format (sourceable):
#   TG_CHAT_ID=12345
#   TG_THREAD_ID=678        # only if present

set -euo pipefail

TG_TARGET_FILE="${TG_TARGET_FILE:-/tmp/tg-target}"

# Read first line of stdin and try to match the bridge's header.
read -r FIRST || FIRST=""

if [[ "$FIRST" =~ ^\[tg:chat_id=([0-9-]+)(:thread_id=([0-9]+))?\]$ ]]; then
  CHAT_ID="${BASH_REMATCH[1]}"
  THREAD_ID="${BASH_REMATCH[3]:-}"
  {
    echo "TG_CHAT_ID=$CHAT_ID"
    [[ -n "$THREAD_ID" ]] && echo "TG_THREAD_ID=$THREAD_ID"
  } > "$TG_TARGET_FILE"
  echo "[tg-target-detect] cached chat_id=$CHAT_ID${THREAD_ID:+ thread_id=$THREAD_ID} -> $TG_TARGET_FILE"
  exit 0
fi

echo "[tg-target-detect] no telegram header found on first line; nothing cached" >&2
exit 0
