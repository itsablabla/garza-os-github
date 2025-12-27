# Credentials Index

Quick lookup for API keys and tokens. **Use `CF MCP:get_secret` first.**

---

## Vault Categories

```
CF MCP:list_secrets category="[category]"
```

| Category | Contains |
|----------|----------|
| `infrastructure` | Cloudflare, Fly.io, DigitalOcean |
| `ai` | Claude, OpenAI, Deepgram, Perplexity |
| `mcp` | All MCP server keys |
| `communication` | Beeper, Twilio, Discord, Gmail |
| `ecommerce` | Chargebee, Shopify, Stripe |
| `n8n` | All n8n instance APIs |
| `supabase` | Vault access keys |
| `smart_home` | UniFi, HOOBS |

---

## Most Used (Copy-Paste)

### Fly.io
```
CF MCP:get_secret name="flyio_org_token"
```
Format: `FlyV1 [long-token]`

### Cloudflare
```
CF MCP:get_secret name="cf_api_token"      # Workers/general
CF MCP:get_secret name="cf_api_key"        # Global key (DNS)
```
Zone ID (garzahive.com): `9c70206ce57d506d1d4e9397f6bb8ebc`

### n8n Cloud
```
CF MCP:get_secret name="n8n_cloud_api"
```
Endpoint: `https://garzasync.app.n8n.cloud`

### GitHub
```bash
# Token embedded in git remote
cd /Users/customer/garza-os-github && git remote get-url origin
```

### Beeper
```
CF MCP:get_secret name="beeper_remote"     # MCP key
CF MCP:get_secret name="beeper_local"      # Local API
```
Local REST: `localhost:8765` with `X-API-Key: garza-beeper-2024`

### Claude/Anthropic
```
CF MCP:get_secret name="claude_api"
```

### Supabase (Vault itself)
```
CF MCP:get_secret name="supabase_service_key"
CF MCP:get_secret name="supabase_anon_key"
```
Project: `vbwhhmdudzigolwhklal.supabase.co`

---

## MCP Server Keys

| Server | Vault Name | Endpoint |
|--------|------------|----------|
| CF MCP | `cf_mcp_key` | localhost:3333 |
| Garza Home | `garza_home_mcp_key` | garza-home-mcp.fly.dev/sse |
| Garza Hive | `garzahive_mcp_key` | mcp.garzahive.com/sse |
| n8n MCP | `n8n_mcp_key` | n8n-mcp.garzahive.com/sse |
| SSH Backup | `ssh_backup_key` | ssh-backup.garzahive.com/sse |

---

## Auth Header Patterns

| Service | Header Format |
|---------|---------------|
| Fly.io | `Authorization: Bearer FlyV1 xxx` |
| Cloudflare API Token | `Authorization: Bearer xxx` |
| Cloudflare Global Key | `X-Auth-Email: jadengarza@pm.me` + `X-Auth-Key: xxx` |
| GitHub | `Authorization: Bearer ghp_xxx` |
| n8n | `X-N8N-API-KEY: xxx` |
| Beeper Local | `X-API-Key: garza-beeper-2024` |
| Anthropic | `x-api-key: xxx` + `anthropic-version: 2023-06-01` |

---

## Fallback: Craft Doc 7061

If vault doesn't have it:
```
Craft:blocks_get id="7061" format="markdown"
```

Contains legacy passwords and tokens in table format.
