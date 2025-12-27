# Garza Cloud MCP

Cloudflare Worker MCP with KV, R2, D1, UniFi Protect, and Beeper integrations.

## Features
- KV storage operations
- R2 object storage
- D1 database queries
- UniFi Protect camera control
- Beeper messaging
- API key management
- Audit logging
- Rate limiting

## Deployment
Cloudflare Workers

## Environment Variables (Secrets)
- `API_KEY` - Standard API key
- `ADMIN_KEY` - Admin operations key
- `PROTECT_URL` - UniFi Protect proxy URL
- `BEEPER_PROXY_URL` - Beeper API proxy
- `BEEPER_TOKEN` - Beeper authentication

## Bindings
- `KV` - KVNamespace
- `DB` - D1Database
- `STORAGE` - R2Bucket

## Tech Stack
- Cloudflare Workers
- TypeScript
