# Beeper Matrix MCP

Full-featured MCP server for Beeper via Matrix protocol. Handles encrypted media.

## Features
- Search chats and messages
- Send messages with attachments
- Download and decrypt Matrix media
- Room management
- Message history

## Deployment
Fly.io (`beeper-matrix-mcp`)

## Environment Variables
- `MATRIX_HOMESERVER` - Matrix server URL (default: matrix.beeper.com)
- `MATRIX_USER_ID` - Matrix user ID (@user:beeper.com)
- `MATRIX_ACCESS_TOKEN` - Matrix access token
- `API_KEY` - Server authentication key

## Tech Stack
- Express.js
- matrix-js-sdk
- E2EE media decryption
