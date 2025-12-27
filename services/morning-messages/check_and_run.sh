#!/bin/bash
LOCKFILE="/tmp/morning-messages-%Y-%m-%d.lock"
if [ -f "" ]; then
    echo "Already ran today"
    exit 0
fi
touch ""
cd ~/morning-messages
python3 morning_love.py
