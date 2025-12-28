# Error Playbook

> When you see error X, do Y. No thinking required.

---

## 🔴 HTTP Errors

### 502 Bad Gateway
**Cause:** App crashed or sleeping
```bash
# Fly.io
fly apps restart <app-name>
fly logs -a <app-name>

# Check if machine exists
fly machines list -a <app-name>
```

### 503 Service Unavailable  
**Cause:** App starting up or no healthy instances
```bash
# Wait 30 seconds, retry
# If persists:
fly status -a <app-name>
fly machines list -a <app-name>
```

### 504 Gateway Timeout
**Cause:** App too slow to respond
```bash
# Check logs for what's hanging
fly logs -a <app-name> --no-tail

# Might need to scale up
fly scale memory 512 -a <app-name>
```

---

## 🔴 Authentication Errors

### GitHub "Authentication failed" on push
**Cause:** PAT token expired (ghp_* tokens expire)
```bash
# Check current remote
git remote get-url origin

# If using HTTPS with token:
# Generate new PAT at github.com/settings/tokens
# Update remote:
git remote set-url origin https://ghp_NEW_TOKEN@github.com/itsablabla/garza-os.git

# BETTER: Switch to SSH (never expires)
git remote set-url origin git@github.com:itsablabla/garza-os.git
ssh-add ~/.ssh/id_garza_master
```

### Fly.io "Not authorized" 
**Cause:** Fly API token expired or wrong org
```bash
# Get new token
fly auth token

# Update in Craft doc 7061 AND GitHub Secrets
# Token format: FlyV1 ... (long string)
```

### Beeper "Unauthorized" / 401
**Cause:** Session expired or wrong API key
```
API Key for REST API: garza-beeper-2024
Port: 8765 (REST API), 23373 (Desktop MCP)

# If session expired, restart Beeper Desktop
# Re-login if needed
```

### n8n Cloud "Invalid API key"
**Cause:** Using wrong instance or key
```
Cloud URL: garzasync.app.n8n.cloud (NOT n8n.garzahive.com)
Header: X-N8N-API-KEY (not Authorization: Bearer)
Get key from: Settings > API in n8n dashboard
```

### UniFi Protect 429 "Too Many Requests"
**Cause:** Hit rate limit on login attempts
```bash
# Wait 5-15 minutes before retry
# Use API key auth instead of username/password
# API key in Craft doc 7061: qa0f8LrqVUD4oLSycbrVybpEmBG6T3l5
```

---

## 🔴 DNS / Certificate Errors

### DNS_PROBE_FINISHED_NXDOMAIN
**Cause:** DNS record doesn't exist or not propagated
```bash
# Check if record exists
dig <domain> +short

# Create via Cloudflare API (use scripts/add-domain.sh)
./scripts/add-domain.sh <subdomain> <fly-app-name>
```

### ERR_CERT_AUTHORITY_INVALID / SSL Error
**Cause:** Certificate not issued yet
```bash
# Check cert status
fly certs show <domain> -a <app-name>

# If not issued, wait 5-10 min
# If stuck, remove and re-add
fly certs remove <domain> -a <app-name>
fly certs add <domain> -a <app-name>
```

### Certificate "Awaiting configuration"
**Cause:** DNS not pointing to Fly yet
```bash
# Verify CNAME points to <app-name>.fly.dev
dig <domain> CNAME +short

# Should return: <app-name>.fly.dev
```

---

## 🔴 MCP Tool Failures

### CF MCP shell_exec returns 500
**Cascade:**
1. Try `CF MCP:ssh_exec` with host "mac"
2. Try `SSH Back Up:ssh_exec` with host "192.168.4.81"
3. Try `Telnet Back Up:ssh_exec` with host "mac"
4. If all fail, Mac might be offline - check via Tailscale

### Garza Home MCP timeout / slow (10+ seconds)
**Cause:** Fly app sleeping or needs restart
```bash
# Wake it up
curl https://garza-home-mcp.fly.dev/health

# If still slow, restart
fly apps restart garza-home-mcp
```

### "Host not found" / ENOTFOUND
**Cause:** Wrong host alias for that MCP server
```
CF MCP hosts:        mac
SSH Back Up hosts:   garzahive, vps, mac
Garza Hive hosts:    garzahive, vps, ssh-bastion, garzahive-01
Last Rock Dev hosts: garzahive, mac, n8n, vps
```

### ECONNREFUSED on localhost:3333
**Cause:** CF MCP server not running on Mac
```bash
# SSH to Mac and check/restart
cd ~/mcp-server && node server.js
# or via launchctl
launchctl load ~/Library/LaunchAgents/com.garza.cf-mcp.plist
```

### Beeper tool timeout / execution error
**Cause:** Beeper Desktop not running or logged out
```
1. Check if Beeper Desktop is open on Mac
2. Check Beeper connection status in app
3. Restart Beeper Desktop if needed
4. Fallback: Use direct REST API on port 8765
```

### Beeper search_messages fails
**Cause:** Search is flaky, use list_messages instead
```
# Instead of search_messages, do:
1. search_chats to find chat ID
2. list_messages with that chat ID
```

---

## 🔴 n8n Workflow Errors

### Workflow failing repeatedly
**Cause:** Usually credential or endpoint issue
```
1. Check execution details in n8n dashboard
2. Look for specific node that failed
3. Common fixes:
   - Expired API key → update credential
   - URL changed → update HTTP node
   - Rate limited → add delay node
```

### n8n MCP not responding
**Cause:** Different from n8n web - it's a separate MCP server
```
# Cloud n8n is at: garzasync.app.n8n.cloud
# Self-hosted was DELETED Dec 26 (n8n.garzahive.com)
# Last Rock Dev MCP talks to cloud instance
```

### "Email to Craft Daily Notes" workflow failing
**Cause:** Known broken workflow, needs ProtonMail bridge
```
# This workflow requires:
1. ProtonMail Bridge running on Mac
2. IMAP access configured
3. Craft API token valid
```

---

## 🔴 Fly.io Deployment Errors

### "Could not find App"
```bash
# Create it first
fly apps create <app-name>
```

### "No machines in app"
```bash
# First deploy creates machine
fly deploy
```

### "Region not available" (Denver deprecated)
```bash
# Use Dallas instead
fly regions set dfw -a <app-name>
```

### "Builder unavailable"
```bash
# Use remote builder
fly deploy --remote-only
```

### "OOM killed" / Out of memory
```bash
fly scale memory 512 -a <app-name>
# or 1024 for heavy apps
```

### npm ci fails in Docker
```dockerfile
# Use npm install instead
RUN npm install --only=production
# npm ci requires package-lock.json
```

---

## 🔴 SSH Relay Issues

### SSH through Fly relay timing out
**Cause:** Relay apps sleeping or network issues
```bash
# Wake relays
curl https://garza-ssh-relay.fly.dev/health
curl https://garza-ssh-relay-2.fly.dev/health

# Check hosts on relay-2
curl -X GET "https://garza-ssh-relay-2.fly.dev/hosts" \
  -H "X-API-Key: gsr2_c9d78e33df694b3c487455c2"
```

### SSH works from Mac but not from MCP
**Cause:** MCP server can't reach target network
```
# Fly apps can't reach:
- Local network devices (192.168.x.x)
- Mac-only resources
- Things behind NAT

# Solution: Use Mac as relay via CF MCP
```

---

## 🔴 Cloudflare Errors

### "Authentication error" on API call
**Cause:** Wrong headers or zone ID
```
Zone ID: 9c70206ce57d506d1d4e9397f6bb8ebc (garzahive.com)
Account ID: 14adde85f76060c6edef6f3239d36e6a

# Use these headers:
X-Auth-Email: <email>
X-Auth-Key: <global api key>
# OR
Authorization: Bearer <api token>
```

### Worker rate limited (error 971)
```bash
# Wait 60 seconds between deploys
# Or use wrangler tail to debug without redeploying
```

### Worker "Script too large"
```
- Remove unused dependencies
- Use external APIs instead of bundling
- Split into multiple workers
```

---

## 🔴 Voice Memo / VoiceNotes Issues

### voicenotes-webhook not receiving memos
**Cause:** Webhook not configured in VoiceNotes app
```
1. Go to voicenotes.com/app → Settings → Webhooks
2. Add URL: https://voicenotes-webhook.jadengarza.workers.dev/webhook
3. Enable: Creating notes, Updating notes, Summary creation
```

### Voice memo transcript shows "eyJ..." (base64)
**Cause:** Corrupted/encoded transcript
```
# Mark as synced to clear queue
# These are broken and can't be processed
POST /notes/:id/synced
```

---

## 🔴 Quick Reference: Which Tool for What

| Task | First Try | Fallback |
|------|-----------|----------|
| Run cmd on Mac | `CF MCP:shell_exec` | `CF MCP:ssh_exec` host=mac |
| Run cmd on GarzaHive | `CF MCP:ssh_exec` host=garzahive | `Garza Hive MCP:execute_command` |
| File ops on Mac | `CF MCP:fs_*` | `CF MCP:shell_exec` with cat/echo |
| Deploy Fly app | `scripts/deploy-fly.sh` | Manual `fly deploy` |
| Add domain | `scripts/add-domain.sh` | Manual CF API + fly certs |
| Git push | `git push` | Check token, switch to SSH |
| Check n8n | `Last Rock Dev:n8n_list_workflows` | Direct API with curl |
| Send message | `Beeper:send_message` | REST API on port 8765 |

---

## 🔴 UniFi Protect Issues

### HTTP 499 / Rate Limiting
**Cause:** Too many API calls to controller
```bash
# Wait 5-15 minutes before retry
# Reduce polling frequency
# Use event-based triggers instead of polling
```

### "Cannot reach NVR from Fly.io"
**Cause:** Fly apps can't reach local 192.168.x.x network
```
# Solutions:
1. Use Cloudflare Tunnel from local device
2. Run service on Mac mini (local network access)
3. Deploy to DigitalOcean droplet with VPN
4. Use garza-home-mcp (has local network via Mac relay)
```

### Camera stream not accessible
**Cause:** RTSP streams protected by SSL fingerprint
```
# MediaMTX required for proxying
# Use local bridge service via tunnel
# streams.garzahive.com for external access
```

---

## 🔴 Container Egress Issues

### "wrangler" fails inside Claude Computer Use
**Cause:** Container egress proxy limitations
```
# Can't deploy from container directly
# Use GitHub Actions for deployments instead
# Or SSH to Mac and run wrangler there
```

### npm install fails for certain packages  
**Cause:** Some registries blocked by proxy
```
# Allowed domains:
- registry.npmjs.org
- github.com
- pypi.org

# Workaround: Build locally, push to repo
```

---

## 🔴 Known Broken Things (Dec 2024)

| Service | Status | Notes |
|---------|--------|-------|
| n8n.garzahive.com | DELETED | Use garzasync.app.n8n.cloud |
| Email to Craft workflow | FAILING | Needs ProtonMail bridge fix |
| Beeper Matrix sync | LIMITED | Only works for unencrypted rooms |
| Computer Use MCP | INCONSISTENT | Screenshots timeout on complex sites |
| VoiceNotes webhook | WORKING | But needs webhook URL configured |
| UniFi from Fly.io | BLOCKED | Use local network services instead |
| Dave auto-responder | FIXED | Was looping, now disabled |
| lastrock-mcp proxy | EXPOSED | Enable Cloudflare proxy needed |

---

## 🔴 Security Exposures (Fix ASAP)

| Endpoint | Issue | Fix |
|----------|-------|-----|
| lastrock-mcp.garzahive.com | proxied=false | Enable CF proxy |
| lrlab-mcp.garzahive.com | proxied=false | Enable CF proxy |
| home-mcp.garzahive.com | proxied=false | Enable CF proxy |
| Craft doc 7061 | Plaintext secrets | Migrate to Doppler |
| Nomad servers (13) | Password auth on | Run master-hardening.sh |
