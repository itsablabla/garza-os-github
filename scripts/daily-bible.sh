#!/bin/bash
BEEPER_TOKEN="3a48068b-e6df-4d9c-b39b-0e41979edaa7"
CHAT_ID="!DkOgxmTdAIVSzEFMXO:beeper.com"
CLAUDE_API_KEY="{{ANTHROPIC_API_KEY}}"

VERSE_JSON=$(curl -s "https://bible.garzahive.com/votd")
REFERENCE=$(echo "$VERSE_JSON" | jq -r '.reference')
TEXT=$(echo "$VERSE_JSON" | jq -r '.text')

MESSAGE=$(curl -s "https://api.anthropic.com/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CLAUDE_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"claude-sonnet-4-20250514\",
    \"max_tokens\": 300,
    \"messages\": [{\"role\": \"user\", \"content\": \"Write a short, warm good morning message for the Garza family incorporating this Bible verse: $REFERENCE - $TEXT. Keep it under 200 words, heartfelt. No quotes around verse.\"}]
  }" | jq -r '.content[0].text')

curl -s -X POST "http://localhost:23373/v1/chats/$CHAT_ID/messages" \
  -H "Authorization: Bearer $BEEPER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$MESSAGE\"}"
