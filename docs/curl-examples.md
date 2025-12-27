# Tested Curl Examples

Copy-paste ready. All tested and working.

---

## Fly.io

```bash
# List all apps
curl -s -H "Authorization: Bearer $FLY_TOKEN" \
  https://api.machines.dev/v1/apps?org_slug=personal | jq '.apps[].name'

# Get app details
curl -s -H "Authorization: Bearer $FLY_TOKEN" \
  https://api.machines.dev/v1/apps/APP_NAME | jq

# List machines in app
curl -s -H "Authorization: Bearer $FLY_TOKEN" \
  https://api.machines.dev/v1/apps/APP_NAME/machines | jq

# Restart machine
curl -X POST -H "Authorization: Bearer $FLY_TOKEN" \
  https://api.machines.dev/v1/apps/APP_NAME/machines/MACHINE_ID/restart
```

---

## Cloudflare DNS

```bash
# List DNS records (CNAME)
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/9c70206ce57d506d1d4e9397f6bb8ebc/dns_records?type=CNAME" \
  -H "X-Auth-Email: jadengarza@pm.me" \
  -H "X-Auth-Key: $CF_KEY" | jq '.result[] | {name, content}'

# Create DNS record
curl -X POST "https://api.cloudflare.com/client/v4/zones/9c70206ce57d506d1d4e9397f6bb8ebc/dns_records" \
  -H "X-Auth-Email: jadengarza@pm.me" \
  -H "X-Auth-Key: $CF_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"subdomain","content":"target.fly.dev","ttl":1,"proxied":false}'

# List Workers
curl -s "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/workers/scripts" \
  -H "Authorization: Bearer $CF_TOKEN" | jq '.result[].id'
```

---

## GitHub Actions

```bash
# Trigger workflow
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW.yml/dispatches" \
  -d '{"ref":"main"}'

# List recent runs
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/OWNER/REPO/actions/runs?per_page=5" | \
  jq '.workflow_runs[] | {name, status, conclusion}'

# Get run jobs
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/jobs" | \
  jq '.jobs[] | {name, conclusion}'
```

---

## n8n Cloud

```bash
# List workflows
curl -s "https://garzasync.app.n8n.cloud/api/v1/workflows" \
  -H "X-N8N-API-KEY: $N8N_KEY" | jq '.data[] | {id, name, active}'

# Get workflow
curl -s "https://garzasync.app.n8n.cloud/api/v1/workflows/WORKFLOW_ID" \
  -H "X-N8N-API-KEY: $N8N_KEY" | jq

# Execute workflow
curl -X POST "https://garzasync.app.n8n.cloud/api/v1/workflows/WORKFLOW_ID/execute" \
  -H "X-N8N-API-KEY: $N8N_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

# Trigger webhook
curl -X POST "https://garzasync.app.n8n.cloud/webhook/WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

---

## Beeper (Local)

```bash
# List accounts
curl -s -H "X-API-Key: garza-beeper-2024" \
  http://localhost:8765/accounts | jq

# Search chats
curl -s -H "X-API-Key: garza-beeper-2024" \
  "http://localhost:8765/chats?query=SEARCH" | jq

# Get messages from chat
curl -s -H "X-API-Key: garza-beeper-2024" \
  "http://localhost:8765/chats/CHAT_ID/messages" | jq
```

---

## Claude API

```bash
# Send message
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $CLAUDE_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## DigitalOcean (Legacy)

```bash
# List droplets
curl -s -H "Authorization: Bearer $DO_TOKEN" \
  "https://api.digitalocean.com/v2/droplets" | jq '.droplets[] | {id, name, status}'

# Create droplet
curl -X POST "https://api.digitalocean.com/v2/droplets" \
  -H "Authorization: Bearer $DO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "name",
    "region": "nyc1",
    "size": "s-1vcpu-1gb",
    "image": "ubuntu-24-04-x64",
    "ssh_keys": [52860258, 52893304, 52816292]
  }'
```

---

## Health Checks

```bash
# Ping Fly app
curl -s -o /dev/null -w "%{http_code}" https://APP.fly.dev/health

# Check MCP SSE endpoint
curl -s "https://garza-home-mcp.fly.dev/sse?key=KEY" -H "Accept: text/event-stream" --max-time 2

# Test Cloudflare Worker
curl -s -o /dev/null -w "%{http_code}" https://WORKER.garzahive.com/
```
