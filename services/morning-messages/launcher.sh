#!/bin/bash
# Morning Messages Launcher - Random time between 7:00-8:00 AM MST

LOG_DIR="$HOME/morning-messages/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

# Random delay 0-60 minutes
DELAY=$((RANDOM % 3600))
DELAY_MIN=$((DELAY / 60))

echo "$(date '+%Y-%m-%d %H:%M:%S') - Triggered, waiting ${DELAY_MIN}m" >> "$LOG_FILE"
sleep $DELAY

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting..." >> "$LOG_FILE"

cd "$HOME/morning-messages"
/usr/bin/python3 morning_love.py >> "$LOG_FILE" 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') - Complete" >> "$LOG_FILE"
