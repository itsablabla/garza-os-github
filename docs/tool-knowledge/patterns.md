# Tool Knowledge Base

> Patterns learned from real usage. Check here before trying something.

---

## Beeper Integration

### API Endpoints
| Port | Service | Auth |
|------|---------|------|
| 23373 | Beeper Desktop MCP | None (local) |
| 8765 | Beeper REST API | X-API-Key: garza-beeper-2024 |

### Search vs List
- `search_messages` is **flaky** - often returns nothing
- `list_messages` with chat ID is **reliable**
- Workflow: `search_chats` → get ID → `list_messages`

### Chat IDs
Common chat IDs are in Craft doc `/System/Identity Map`
- Jessica: Check Beeper for current ID
- Family group "Bonnie and Clyde": Search by name

### Message Sending
```javascript
// Direct REST API when MCP fails
curl -X POST http://localhost:8765/v1/chats/{chatId}/messages \
  -H "X-API-Key: garza-beeper-2024" \
  -H "Content-Type: application/json" \
  -d '{"text": "message"}'
```

### User ID Format
Full Matrix format: `@jadengarza:beeper.com`
- Used in sender filtering
- Config must match exactly or filtering breaks
- This caused the Dave auto-responder message loop

---

## Fly.io Operations

### Deployment
```bash
# Always use
fly deploy --remote-only

# For Node.js, in Dockerfile use:
RUN npm install --only=production
# NOT npm ci (requires package-lock.json)
```

### Regions
- ❌ Denver (den) - DEPRECATED
- ✅ Dallas (dfw) - Use this
- ✅ Chicago (ord) - Backup

### Token Formats
- `FlyV1 ...` - Older org token
- `fm2_...` - Newer machine/deploy token
- Both work for `fly` CLI
- Store in GitHub Secrets as `FLY_API_TOKEN`

### Waking Sleeping Apps
```bash
# Just hit health endpoint
curl https://<app>.fly.dev/health

# Or force restart
fly apps restart <app>
```

### Machines API
```bash
# List machines
curl -H "Authorization: Bearer $FLY_TOKEN" \
  https://api.machines.dev/v1/apps/<app>/machines

# Restart specific machine
curl -X POST -H "Authorization: Bearer $FLY_TOKEN" \
  https://api.machines.dev/v1/apps/<app>/machines/<id>/restart
```

---

## n8n Cloud Integration

### Endpoints
```
Production: https://garzasync.app.n8n.cloud
API Base: /api/v1/
Auth Header: X-N8N-API-KEY
```

### Workflow Import
```javascript
// active field is READ-ONLY on create
// Remove it before POST, then activate separately
POST /api/v1/workflows  // without active field
POST /api/v1/workflows/{id}/activate
```

### Execution Query
```javascript
// Get failures
GET /api/v1/executions?status=error&limit=10

// Get specific workflow runs
GET /api/v1/executions?workflowId={id}&limit=10
```

### Common Workflow IDs
Check DEPLOYED.yml or n8n dashboard for current IDs

---

## Cloudflare Workers

### Account/Zone IDs
```
Account ID: 14adde85f76060c6edef6f3239d36e6a
Zone ID (garzahive.com): 9c70206ce57d506d1d4e9397f6bb8ebc
```

### Deployment
```bash
# Need account_id in wrangler.toml when multiple accounts
account_id = "14adde85f76060c6edef6f3239d36e6a"

# Wrangler location on Mac
/Users/customer/.npm-global/bin/wrangler
```

### Secrets
```bash
# Set via wrangler
echo "value" | wrangler secret put SECRET_NAME

# NOT in code - security risk
```

### KV Bindings
```toml
[[kv_namespaces]]
binding = "NOTES"
id = "b1da2788747e4fb5b65eee62538f6b18"
```

### Cron Triggers
```toml
[triggers]
crons = ["*/30 * * * *"]  # Every 30 min
```

---

## UniFi Protect

### API Endpoints
```
Integration API: /proxy/protect/integration/v1/
Standard API: /proxy/protect/api/ (less reliable)
Auth: X-API-Key header
```

### Common Keys
```
Boulder Alpine: 2kqc5fs-7JDgduMlLJ3z436YGaR16tnO
Estate: Check Craft doc 7061
```

### RTSPS Streams
```
URL format: rtsps://host:7441/tokenstring?enableSrtp
- Token unique per camera
- Get from UniFi Protect UI after enabling RTSP
```

### Rate Limiting
- 429 after too many login attempts
- Wait 5-15 minutes
- Use API key auth, not username/password

---

## Craft MCP

### Key Documents
| ID | Purpose |
|----|---------|
| 7061 | API keys and passwords |
| 14219 | Master Config |
| 7853 | Voice Memos folder |
| 6996 | Identity Map |
| 17348 | MCP Audit |

### Document Creation
```javascript
// Create in folder
documents_create({
  documents: [{ title: "Name" }],
  destination: { folderId: "7853" }
})

// Add content
markdown_add({
  markdown: "# Content",
  position: { pageId: docId, position: "end" }
})
```

### Search Patterns
```javascript
// Regex search
documents_search({
  regexps: "pattern",
  location: "daily_notes"  // or folderIds
})

// Full text
documents_search({
  include: ["keyword1", "keyword2"]
})
```

---

## SSH Operations

### Host Mapping by MCP
| MCP | Hosts Available |
|-----|-----------------|
| CF MCP | mac |
| SSH Back Up | garzahive, vps, mac |
| Garza Hive MCP | garzahive, vps, ssh-bastion, garzahive-01 |
| Last Rock Dev | garzahive, mac, n8n, vps |
| Telnet Back Up | garzahive, mac, vps |

### Key Server IPs
```
GarzaHive-01: 192.241.139.240
SSH Bastion: 143.198.190.20
Mac Mini (Boulder): 192.168.4.81 (local)
n8n Server: 167.172.147.240
```

### Primary SSH Key
```
~/.ssh/id_garza_master (created Dec 25, 2024)
# This is the current primary key
# Old keys (id_ed25519, id_ed25519_new) are deprecated
```

---

## GitHub Operations

### SSH vs HTTPS
```bash
# SSH (preferred - never expires)
git@github.com:itsablabla/garza-os.git

# HTTPS with token (expires)
https://ghp_TOKEN@github.com/itsablabla/garza-os.git
```

### Actions Secrets
Required secrets for workflows:
- `FLY_API_TOKEN` - Fly.io deploy token
- `PUSHCUT_KEY` - For alerts
- `N8N_API_KEY` - n8n Cloud API
- `CF_API_TOKEN` - Cloudflare

### Workflow Dispatch
```bash
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/itsablabla/garza-os/actions/workflows/deploy.yml/dispatches \
  -d '{"ref":"main"}'
```

---

## VoiceNotes Integration

### Webhook Endpoints
```
Webhook: https://voicenotes-webhook.jadengarza.workers.dev/webhook
Sync: POST /sync
Get notes: GET /notes?limit=10&unsynced=true
Mark synced: POST /notes/:id/synced
```

### Trigger Words
Memory edit configured for: "vm", "voice", "memo"
→ Triggers sync and processing

### Processing Flow
1. POST /sync - pulls from VoiceNotes API
2. GET /notes - retrieves transcripts
3. Classify content type
4. Route to appropriate action

---

## MCP Connection Patterns

### SSE vs HTTP
- Claude.ai uses SSE connections to MCP servers
- Endpoint format: `/sse?key=auth-key`
- POST requests go to `/message/:clientId`
- Responses stream back on SSE

### Health Checks
```bash
# Most MCPs
curl https://server.fly.dev/health

# Beeper MCP returns 405 (normal)
curl https://beeper-mcp.garzahive.com/v0/mcp
# 405 = server up, just wrong method
```

### Timeout Handling
- CF MCP shell_exec: 30s default
- Long commands: use nohup + background
```bash
nohup long_command > /tmp/output.log 2>&1 &
sleep 5
cat /tmp/output.log
```
