# Tool Knowledge Base

**Compiled: December 26, 2025**
**Source: Claude Chat History Analysis**

This document contains learned patterns, gotchas, and best practices for GARZA OS tools.

---

## Beeper MCP Integration

### API Structure
- Beeper Desktop runs on **port 23373**
- Beeper REST API runs on **port 8765** with `X-API-Key: garza-beeper-2024`
- Cloudflare tunnel routes:
  - `beeper-mcp.garzahive.com` → localhost:23373
  - `beeper-bridge.garzahive.com` → localhost:8765

### Search Functions
- `search_chats` returns SSE responses with JSON-wrapped markdown
- Parse with regex: `/## (.+?) \(chatID: ([^)]+)\)/g`
- `list_messages` returns proper JSON with `items` array
- `search_messages` returns formatted markdown - different parsing needed

### Matrix Media Handling
- Media URLs with `encryptedFileInfoJSON` contain base64-encoded encryption metadata
- Encryption uses **AES-256-CTR**
- Keys need base64url decoding: replace `-` with `+` and `_` with `/`
- Use Node.js crypto for decryption

### Message Automation
- When building auto-responders, sender filtering requires **exact user ID matching**
- Format: `@username:beeper.com` (full Matrix format)
- Config must use `@jadengarza:beeper.com` NOT `@jaden:beeper.com`
- Even small discrepancies cause message loops where bot responds to itself

### Auto-Responder Debugging
- Check recent messages with API to see actual senderID format
- Beeper API shows senderIDs in full Matrix format like `@username:beeper.com`
- launchd services: `launchctl unload ~/Library/LaunchAgents/[service].plist`
- Check config file user IDs match actual sender format

---

## Fly.io Deployments

### flyctl Installation
```bash
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"  # Required for each command
```

### Region Notes
- **Denver (den) is deprecated** → auto-redirects to Dallas (dfw)
- Update fly.toml when region redirect occurs

### Volume Management
- Volumes must be created in **same region as app**
- Existing machines without mounts need destruction before redeployment
- Use `fly volumes create [name] --size 1 --region dfw`

### Secrets
```bash
flyctl secrets set KEY1=value1 KEY2=value2 -a app-name
```

### Common fly.toml Pattern
```toml
app = "app-name"
primary_region = "dfw"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
```

### Custom Domains for Fly.io
1. Create DNS A/AAAA records pointing to Fly IPs:
   - IPv4: `66.241.124.34`
   - IPv6: `2a09:8280:1::be:5a29:0`
2. Run: `fly certs add domain.com -a app-name`
3. Set `proxied: false` in Cloudflare (Fly handles SSL)

---

## Cloudflare Configuration

### DNS Management
- Global API Key works better than API tokens for DNS operations
- Headers required:
  - `X-Auth-Email: jadengarza@pm.me`
  - `X-Auth-Key: [global-api-key]`
- Zone ID for garzahive.com: `9c70206ce57d506d1d4e9397f6bb8ebc`

### Tunnel Configuration
- Use `http://127.0.0.1:PORT` instead of `http://localhost:PORT`
- Localhost causes IPv6 routing issues (`[::1]:PORT` connections)
- Config location: `~/.cloudflared/config.yml`
- DNS records: CNAME to `[tunnel-uuid].cfargotunnel.com`

### Workers Service Bindings
- Worker-to-worker fetch causes error 1042 (direct fetch not allowed)
- Use service bindings: `env.SERVICENAME.fetch()` instead of HTTP calls
- Configure in wrangler.toml with exact namespace IDs

---

## Matrix Bridge Configuration

### Conduit Server
- Appservice registration via admin room commands, not config files
- Format: `@conduit:domain: register_appservice` + YAML in code blocks
- Bridges must be registered before they can authenticate

### Bridge Config Updates (Go-based: WhatsApp, Meta, Slack, Discord)
```yaml
address: http://conduit:6167  # Internal Docker address
domain: matrix.garzahive.com
hostname: 0.0.0.0  # Not 127.0.0.1 for Docker networks
```

### Python Bridge Logging Fix
Remove file handlers that lack write permissions:
- Delete entire file handler sections
- Keep only console handlers

---

## Home Assistant

### Trusted Proxies
Required for Cloudflare tunnel:
```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 172.16.0.0/12
    - 192.168.0.0/16
    - 10.0.0.0/8
```
Container restart required after changes.

---

## UniFi Protect Integration

### Camera Streaming with MediaMTX
- Use MediaMTX for RTSP re-streaming to avoid API rate limits
- RTSPS URLs require SSL fingerprint for certificate bypass
- Fingerprint format: 64-character hex string (not "insecure")
- When containers can't reach local network, use `network_mode: host`
- RTSP URL format: `rtsps://192.168.10.49:7441/[token]?enableSrtp`

### Authentication
- Local administrator accounts required (SSO won't work for API)
- Rate limiting (HTTP 429) at IP level, can persist 15-30 minutes
- Create local account like "server" with password for API access

### Network Architecture
- UniFi Protect at 192.168.10.49 (Boulder local network)
- Remote services need VPN or tunnel to reach local devices

---

## VoiceNotes Integration

### API Endpoint
```
POST https://api.voicenotes.com/api/integrations/obsidian-sync/recordings
Headers:
  Authorization: Bearer [obsidian-key]
  X-API-KEY: [obsidian-key]
Body: {}
```
- Only accepts POST with empty JSON body, not GET
- Transcripts contain HTML `<br>` tags - clean with:
```javascript
.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
```

---

## HOOBS / Homebridge

### Node.js Compatibility
- HOOBS Docker images use Node 14, but homebridge-unifi-protect requires Node 20+
- Use official Homebridge Docker container with Node 24 for better compatibility
- HOOBS SDK is just an API wrapper, needs HOOBS daemon to connect to

### Installation
```bash
npm install -g hoobs-cli
hoobs-cli init
hoobs-cli start
```

---

## Discord Bot Integration

### Configuration
- Guild ID: `1438654921430929620` (Jaden AI Server)
- Channel creation: type 0 for text channels
- Token format: `Bot [token]` in Authorization header

### Claude Desktop Bridge
- n8n webhooks trigger Claude Desktop via remote control server
- Uses AppleScript for Cmd+K chat switching
- Requires 0.3-0.5 second delays between keystrokes
- Screen recording permissions needed for screenshot-based OCR

---

## Element Web for Beeper

### Configuration
Element Web can connect to Beeper's Matrix backend:
```json
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "https://matrix.beeper.com",
      "server_name": "beeper.com"
    }
  }
}
```
Note: Beeper uses proprietary auth - third-party clients may not fully work.

---

## Playwright MCP (Browser Automation)

### Fly.io Deployment
```dockerfile
FROM mcr.microsoft.com/playwright/python:latest
ENTRYPOINT ["node", "cli.js"]
CMD ["--headless", "--browser", "chromium", "--no-sandbox", 
     "--port", "8931", "--host", "0.0.0.0", "--allowed-hosts", "*"]
```
- `--host 0.0.0.0` required to bind beyond localhost
- `--allowed-hosts "*"` required for external connections
- Endpoint: `https://[app].fly.dev/sse`

---

## Octelium Zero Trust

### Deployment
- Demo cluster script: `https://octelium.com/install-demo-cluster.sh`
- Run with `--domain [target-domain]` parameter
- Uses k3s Kubernetes under the hood

### TLS Certificates
```bash
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d "*.domain.com" -d "domain.com"
```
- Credentials format in cloudflare.ini required
- Apply certs via kubectl to octelium namespace

---

## Mac Automation (launchd)

### Service Control
```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/[service-name].plist

# Check what's running on a port
lsof -nP -iTCP:PORT -sTCP:LISTEN
```

### Path Configuration
```bash
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"  # Force Node version
```

---

## MCP Server Debugging

### Connectivity Testing
```bash
# Test REST API directly
curl -H 'X-API-Key: [key]' http://localhost:PORT/endpoint

# Check processes on port
lsof -nP -iTCP:PORT -sTCP:LISTEN
ps aux | grep [service]
```

### Common Issues
- Server connected ≠ tools available (can fail independently)
- Tool prefixes (e.g., "CF MCP:") indicate proxy routing
- Test underlying services before debugging MCP proxy layer
- Health endpoint verifies connectivity, but check tools endpoint separately

### MCP Server SSE Pattern
```javascript
// SSE endpoint with API key
app.get('/sse', (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send('Unauthorized');
  // ... SSE setup
});

// Messages endpoint should also verify key
app.post('/messages', (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json({ error: 'Invalid key' });
  // ... handle messages
});
```

---

## n8n Integration

### Workflow Execution
- Workflows created via API don't auto-register webhooks until activated in UI
- Error watcher workflow runs every 15 minutes
- MCP Server requires JWT token from n8n UI (not standard API key)

### Configuration
```bash
# Enable MCP Server
N8N_PUBLIC_API_ENABLED=true
N8N_MCP_SERVER_ENABLED=true
```

---

## GitHub Repository Workflow

### Sync Pattern
```bash
cd /Users/customer/garza-os-github
./sync.sh
git add -A && git commit -m "description" && git push
```

### After MCP Server Changes
Always sync to garza-os repo to maintain version history.


---

## DigitalOcean Deployments

### API Pattern
```bash
curl -X POST "https://api.digitalocean.com/v2/droplets" \
  -H "Authorization: Bearer [DO_TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{"name":"droplet-name","region":"nyc1","size":"s-2vcpu-4gb","image":"ubuntu-24-04-x64","ssh_keys":[52860258,52893304,52816292],"tags":["garza-infra"]}'
```
- SSH key IDs: 52860258, 52893304, 52816292
- Common sizes: s-2vcpu-4gb (8GB RAM), s-4vcpu-8gb
- Images: ubuntu-24-04-x64

### Octelium Zero Trust on DigitalOcean
- Deploy 4GB+ RAM droplet for k3s cluster
- Install script handles k3s + Octelium automatically
- DNS: Create A record pointing to droplet IP
- TLS: Use certbot with cloudflare plugin for wildcard certs

---

## Beeper Media Download

### Matrix Encrypted Media
```javascript
// Media URLs with encryptedFileInfoJSON contain base64-encoded metadata
// Keys need base64url decoding: replace - with + and _ with /
const key = atob(encKey.replace(/-/g, '+').replace(/_/g, '/'));
```
- Encryption: AES-256-CTR
- IV from file info JSON
- Use Node.js crypto for decryption

### Backfill Endpoint Pattern
```javascript
app.get('/backfill', async (req, res) => {
  const { room_id, limit = 100 } = req.query;
  // Fetch historical messages from Matrix
  // Store voice memos in database
});
```

---

## Cloudflare Workers Entity Extraction

### Claude API for Processing
```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  })
});
```
- Use explicit JSON instructions: "Return ONLY valid JSON"
- Helps avoid markdown formatting in responses

### KV Namespace Bindings
```toml
# wrangler.toml
[[kv_namespaces]]
binding = "VOICENOTES_KV"
id = "actual-namespace-id"
```

---

## SSH Relay Pattern

### Fly.io SSH Tunnels
- SSH Back Up: https://ssh-backup2.garzahive.com (DFW region)
- Telnet Back Up: https://ssh-backup.garzahive.com (DEN region - legacy)
- Both provide SSH access to mac, garzahive, vps hosts

### Host Aliases
```
mac = customer@45.147.93.59 (hosted Mac)
garzahive = root@garzahive-01.garzahive.com
vps = root@[VPS IP]
ssh-bastion = relay jump host
```

---

## Last Updated
December 27, 2025 - Added DigitalOcean deployment, Beeper media, entity extraction patterns


---

## lrlab-mcp v3 (December 2025)

### Tool Inventory (32 tools)
- **Core**: `ping`, `ssh_exec`, `ssh_hosts`
- **GitHub**: `list_repos`, `get_repo`, `list_issues`, `create_issue`, `create_repo`, `list_prs`, `create_pr`, `get_workflow_runs`, `trigger_workflow`, `get_file`, `update_file`
- **Fly.io**: `fly_list_apps`, `fly_get_app`, `fly_logs`, `fly_restart`, `fly_set_secret`
- **Cloudflare DNS**: `cf_list_dns`, `cf_create_dns`, `cf_delete_dns`
- **n8n Cloud**: `n8n_list_workflows`, `n8n_get_workflow`, `n8n_execute_workflow`, `n8n_activate_workflow`, `n8n_list_executions`
- **Health**: `health_check_all` (pings all MCP endpoints)
- **Scout APM**: `scout_list_apps`, `scout_get_app_endpoints`, `scout_get_insights`, `scout_get_error_groups`

### Endpoint
- SSE: `https://lastrock-mcp.garzahive.com/sse?key=lrlab-dev-v2-a7c9e3f18b2d4e6f`
- Health: `https://lastrock-mcp.garzahive.com/health`

---

## Octelium Zero Trust

### Deployment on DigitalOcean
- Droplet: `octelium-secure` (68.183.108.79)
- Region: nyc1
- Size: s-2vcpu-4gb
- Image: ubuntu-24-04-x64

### Installation
```bash
# Demo cluster installs k3s + Octelium
curl -fsSL https://octelium.com/install-demo-cluster.sh | bash -s -- --domain secure.garzahive.com
```

### TLS Certificates
- Use certbot with Cloudflare DNS plugin:
```bash
pip install certbot-dns-cloudflare
certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d secure.garzahive.com -d *.secure.garzahive.com
```
- Cloudflare credentials format:
```ini
dns_cloudflare_email = jadengarza@pm.me
dns_cloudflare_api_key = [global-api-key]
```

### Kubectl Secret for TLS
```bash
kubectl create secret tls octelium-tls \
  --cert=/etc/letsencrypt/live/secure.garzahive.com/fullchain.pem \
  --key=/etc/letsencrypt/live/secure.garzahive.com/privkey.pem \
  -n octelium
```

---

## VoiceNotes.com Integration

### API Endpoint
```
POST https://api.voicenotes.com/api/integrations/obsidian-sync/recordings
```

### Headers
```
Authorization: Bearer [obsidian-key]
X-API-KEY: [obsidian-key]  # Same key in both headers
Content-Type: application/json
```

### Request Body
- Empty JSON object `{}`
- Response contains array of recordings with transcripts

### Transcript Cleaning
```javascript
transcript.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
```

---

## n8n Cloud API

### Endpoint Format
```
https://[subdomain].app.n8n.cloud/api/v1/
```

### Jaden's Instance
- URL: `https://jadengarza.app.n8n.cloud`
- API key stored in Craft doc 7061

### Endpoints
- `GET /workflows` - List all workflows
- `GET /workflows/{id}` - Get single workflow
- `POST /workflows/{id}/activate` - Activate workflow
- `POST /workflows/{id}/deactivate` - Deactivate workflow
- `POST /workflows/{id}/run` - Execute workflow
- `GET /executions` - List executions

### Headers
```
X-N8N-API-KEY: [jwt-token]
```

---

## HOOBS / Homebridge Compatibility

### Node.js Version Issues
- HOOBS Docker images use Node 14
- `homebridge-unifi-protect` plugin requires Node 20+
- Custom HOOBS images with Node 20 still have Homebridge version conflicts

### Solution
Use official Homebridge Docker instead:
```bash
docker run -d \
  --name homebridge \
  --net=host \
  -v /path/to/config:/homebridge \
  -e TZ=America/Denver \
  homebridge/homebridge:latest
```

### UniFi Protect Requirements
- **Local admin account required** - SSO credentials don't work for API
- Create account in UniFi Protect UI > Users > Invite User > Local Access
- RTSP must be enabled per-camera in UniFi Protect settings
- Rate limiting (HTTP 429) can persist 15-30 minutes at IP level

---

## Element Web for Beeper

### Limitation
- Beeper uses proprietary auth that blocks standard Matrix clients
- Element Web can connect but auth flows may not work

### Alternative: Beeper Desktop + VNC
- Run actual Beeper Electron app in container
- Access via noVNC for remote control
- Better compatibility than third-party Matrix clients

### Element Config for Beeper (if attempting)
```json
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "https://matrix.beeper.com",
      "server_name": "beeper.com"
    }
  }
}
```

---

## Cloudflare Workers Service Bindings

### Worker-to-Worker Calls
- Direct HTTP fetch between workers in same zone returns error 1042
- Solution: Use service bindings in wrangler.toml

```toml
[[services]]
binding = "OTHER_WORKER"
service = "other-worker-name"
```

### Usage in Code
```javascript
// Wrong - causes error 1042
await fetch('https://other-worker.garzahive.workers.dev/endpoint')

// Right - uses service binding
await env.OTHER_WORKER.fetch(new Request('http://internal/endpoint'))
```

---

## Entity Extraction with Claude API

### Cloudflare Worker Pattern
```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  })
});
```

### JSON Response Forcing
- Include "Return ONLY valid JSON, no markdown" in prompt
- Parse response with try/catch for robustness
- Claude may still add markdown backticks - strip them:
```javascript
let text = response.content[0].text;
text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
const data = JSON.parse(text);
```
