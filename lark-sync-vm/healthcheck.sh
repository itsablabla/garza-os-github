#!/bin/sh
# Healthy if the sync loop touched the heartbeat file in the last 30 minutes
HEARTBEAT=/tmp/lark-sync-alive
MAX_AGE=1800

if [ ! -f "$HEARTBEAT" ]; then exit 1; fi

AGE=$(( $(date +%s) - $(date -r "$HEARTBEAT" +%s 2>/dev/null || echo 0) ))
[ "$AGE" -lt "$MAX_AGE" ] || exit 1
