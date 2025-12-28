# Quick Reference Card

> Print this or keep it open. Everything you need in one place.

---

## 🔑 Key Credentials

| Service | Where | Format |
|---------|-------|--------|
| Fly.io | Vault `flyio_org_token` | FlyV1 ... |
| Cloudflare | Vault `cf_api_token` | Bearer token |
| n8n Cloud | Vault `n8n_cloud_api` | X-N8N-API-KEY header |
| Beeper REST | Hardcoded | X-API-Key: garza-beeper-2024 |
| UniFi Boulder | Craft 7061 | qa0f8LrqVUD4oLSycbrVybpEmBG6T3l5 |

---

## 🌐 Key Endpoints

| Service | URL |
|---------|-----|
| Garza Home MCP | https://garza-home-mcp.fly.dev/sse?key=garza-home-v2-26f93afcebe2ea974cceeddbddeb4fdb |
| Last Rock Dev | https://lastrock-mcp.garzahive.com/sse?key=lrlab-dev-v2-a7c9e3f18b2d4e6f |
| CF MCP | https://mcp-cf.garzahive.com/sse?key=a505d6e718eec02e2ee95ec3fcd6c0623197b013d143b993dcfa4d5eb60eaf0c |
| n8n Cloud | https://garzasync.app.n8n.cloud |
| Beeper REST | localhost:8765 |
| Beeper MCP | localhost:23373 |

---

## 🖥️ Server IPs

| Name | IP | Purpose |
|------|-----|---------|
| SSH Bastion | 143.198.190.20 | Jump host (hardened) |
| GarzaHive-01 | 192.241.139.240 | Main VPS |
| Octelium | 68.183.108.79 | Zero trust cluster |
| Boulder Mac | 192.168.4.81 | Local compute |

---

## 📁 Key Craft Docs

| ID | Content |
|----|---------|
| 7061 | API keys (migrate to Doppler) |
| 14219 | Master Config |
| 17348 | MCP Audit |
| 7853 | Voice Memos folder |
| 6996 | Identity Map |
| 18011 | Email classification logs |

---

## 🔧 Common Commands

```bash
# Deploy to Fly.io
fly deploy --remote-only -a <app-name>

# Check Fly app status
fly status -a <app-name>

# Restart Fly app
fly apps restart <app-name>

# View Fly logs
fly logs -a <app-name>

# Deploy Cloudflare Worker
wrangler deploy

# Git push (SSH)
git add -A && git commit -m "msg" && git push

# Health check all MCPs
./scripts/health-check.sh
```

---

## 🚨 When Things Break

| Symptom | First Try |
|---------|-----------|
| MCP timeout | `fly apps restart <app>` |
| 502 error | Check `fly logs -a <app>` |
| Auth failed | Check token expiry |
| Can't push | Switch to SSH: `git@github.com:itsablabla/garza-os.git` |
| Beeper fails | Restart Beeper Desktop on Mac |

---

## 📊 Current Status

**Active MCP Servers (4 core):**
1. Craft (Anthropic connector)
2. CF MCP (Mac - local network)
3. Garza Home MCP (Fly - 42 tools)
4. Last Rock Dev (Fly - 32 tools)

**Retire Soon:**
- Garza Hive MCP
- SSH Back Up
- Telnet Back Up
- Beeper Standalone

**n8n:**
- Production: garzasync.app.n8n.cloud (28 workflows)
- Local: DELETED

---

## 🔐 Security Reminders

- [ ] Enable 2FA on all cloud accounts
- [ ] Migrate secrets from Craft 7061 to Doppler
- [ ] Enable CF proxy on exposed MCP endpoints
- [ ] Run hardening script on remaining servers
