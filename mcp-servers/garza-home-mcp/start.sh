#!/bin/bash
cd "$(dirname "$0")"

# Get Matrix token from Beeper Desktop
export MATRIX_ACCESS_TOKEN=$(sqlite3 "$HOME/Library/Application Support/BeeperTexts/account.db" "SELECT access_token FROM account LIMIT 1;")
export MATRIX_HOMESERVER="https://matrix.beeper.com"
export MATRIX_USER_ID="@jadengarza:beeper.com"

# Get other secrets from secure storage (set these manually or from keychain)
export API_KEY="${GARZA_HOME_API_KEY:-garza-home-v2-26f93afcebe2ea974cceeddbddeb4fdb}"
export BEEPER_API_KEY="${BEEPER_API_KEY}"
export UNIFI_API_KEY="${UNIFI_API_KEY}"
export ABODE_TOKEN="${ABODE_TOKEN}"
export PORT=3200

echo "Starting Garza Home MCP v2.1..."
echo "Matrix: ${MATRIX_ACCESS_TOKEN:+configured}"
echo "Beeper: ${BEEPER_API_KEY:+configured}"
echo "UniFi: ${UNIFI_API_KEY:+configured}"
echo "Abode: ${ABODE_TOKEN:+configured}"

exec node server.mjs
