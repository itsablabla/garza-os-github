# Tool Knowledge Base

**Compiled: 2025-12-26**
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
- Even small discrepancies (missing characters) cause message loops

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

### Custom Domains for Fly.io
1. Create DNS A/AAAA records pointing to Fly IPs:
   - IPv4: `66.241.124.34`
   - IPv6: `2a09:8280:1::be:5a29:0`
2. Run: `fly certs add domain.com -a app-name`
3. Set `proxied: false` in Cloudflare (Fly handles SSL)

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

### Camera Streaming
- Use MediaMTX for RTSP re-streaming to avoid API rate limits
- RTSPS URLs require SSL fingerprint for certificate bypass
- Fingerprint format: 64-character hex string
- When containers can't reach local network, use `network_mode: host`

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
- Transcripts contain HTML `<br>` tags - clean with regex

---

## Garza Ears Pipeline

### Processing Flow
1. Poll Beeper for audio messages (60-second intervals)
2. Download encrypted Matrix media
3. Decrypt using AES-256-CTR
4. Transcribe with OpenAI Whisper
5. Summarize with Claude
6. Store in Craft `/Garza Memory/Voice Memos/`

### Decryption Pattern
```javascript
const keyBuffer = Buffer.from(base64urlDecode(key), 'base64');
const ivBuffer = Buffer.from(base64urlDecode(iv), 'base64');
const decipher = crypto.createDecipheriv('aes-256-ctr', keyBuffer, ivBuffer);
```

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

## Claude Remote Control (Discord Bridge)

### Architecture
- Discord messages → n8n webhook → Claude Desktop remote server
- Uses AppleScript for Cmd+K chat switching
- Requires 0.3-0.5 second delays between keystrokes
- Screen recording permissions needed for screenshot-based OCR

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
