#!/bin/bash
curl -s -X POST https://jessica-bot.fly.dev/trigger -H "X-Webhook-Secret: jessica-program-2024" >> ~/jessica-bot/trigger.log 2>&1
