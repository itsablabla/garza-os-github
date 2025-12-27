# Claude Pre-Flight Checklist

**READ THIS FIRST** before starting any task. Saves 3-5 tool calls per session.

---

## 🎯 Quick Decision Tree

```
What am I doing?
│
├─ Building something new?
│   └─ FIRST: Read stack-first.md
│       USE: Fly.io, n8n, Supabase, GitHub, CF Workers
│       NEVER: New services, new databases, VPS
│
├─ Running shell commands?
│   └─ START: CF MCP:shell_exec
│       FALLBACK: CF MCP:ssh_exec host=mac
│       LAST RESORT: SSH Back Up:ssh_exec host=192.168.4.81
│
├─ Deploying something?
│   └─ USE: Fly.io (always)
│       NEVER: DigitalOcean (phasing out)
│       CHECK: DEPLOYED.yml for existing apps
│
├─ Need an API key?
│   └─ FIRST: CF MCP:get_secret name="[service]_api"
│       FALLBACK: Craft doc 7061
│       SEE: credentials-index.md
│
├─ Building MCP server?
│   └─ CHECK: /templates/fly-mcp/ for starter
│       CHECK: /templates/snippets/ for API patterns
│
└─ Hit an error?
    └─ CHECK: error-playbook.md
        CHECK: fallback-diagram.md
```

---

## 🏗️ The Stack (Use These First)

| Need | Tool | Why |
|------|------|-----|
| Hosting | **Fly.io** | Containers, secrets, scaling |
| Automation | **n8n Cloud** | Workflows, webhooks, cron |
| Database | **Supabase** | Postgres, auth, vault |
| Serverless | **Cloudflare Workers** | Edge, fast, free tier |
| CI/CD | **GitHub Actions** | Auto-deploy on push |
| Knowledge | **Craft** | Docs, memory, source of truth |

**→ See `stack-first.md` for decision matrix**

---

## 🔑 Top 10 Credentials (Vault Names)

| Service | Vault Secret Name | Notes |
|---------|-------------------|-------|
| Fly.io | `flyio_org_token` | Deploy token, starts with FlyV1 |
| Cloudflare | `cf_api_token` | Workers/DNS |
| Claude API | `claude_api` | Anthropic |
| Beeper | `beeper_remote` | MCP access |
| n8n Cloud | `n8n_cloud_api` | garzasync.app.n8n.cloud |
| GitHub | Check git config | Token in remote URL |
| Craft | `craft_api_endpoint` | Full SSE URL |
| ProtonMail | Check CF MCP | Bridge on Mac |
| Supabase | `supabase_service_key` | Vault access |
| DigitalOcean | `digitalocean_token` | Legacy, avoid |

---

## 🖥️ Server Selection

| Task | Use This | Why |
|------|----------|-----|
| New deployment | Fly.io | Auto-scaling, easy secrets |
| Shell commands | CF MCP:shell_exec | Direct Mac access |
| File operations | CF MCP:fs_* | Local filesystem |
| Persistent storage | Supabase | Or Fly volumes |
| Cron jobs | n8n Cloud | Or CF Workers |
| One-off scripts | Mac via SSH | Already running |

**NEVER use DigitalOcean for new work** - Garza Hive is phasing out.

---

## ⚡ Before You Build

1. **Check stack-first.md**: Can existing tools do this?
2. **Check if it exists**: `grep -r "keyword" /Users/customer/garza-os-github/`
3. **Check DEPLOYED.yml**: Is something similar already running?
4. **Check templates/**: Is there a starter for this?
5. **Check snippets/**: Is the API pattern already written?

---

## 🚨 Common Mistakes to Avoid

| Mistake | Instead |
|---------|---------|
| Spinning up new database | Use Supabase |
| Custom cron script | Use n8n workflow |
| Guessing n8n URL | It's `garzasync.app.n8n.cloud` |
| Using Bearer for Cloudflare | Use X-Auth-Email + X-Auth-Key |
| Deploying to Denver region | Use `dfw` (Dallas) - Denver deprecated |
| Running npm ci in Docker | Use `npm install --only=production` |
| Trying to reach local network from Fly | Can't - use Mac for local devices |

---

## 📍 Key Endpoints

| Service | Endpoint |
|---------|----------|
| Garza Home MCP | https://garza-home-mcp.fly.dev/sse |
| CF MCP | localhost:3333 (via tunnel) |
| Beeper REST | localhost:8765 (X-API-Key: garza-beeper-2024) |
| Beeper Desktop MCP | localhost:23373 |
| n8n Cloud | https://garzasync.app.n8n.cloud |
| Supabase | Check vault for URL |
| Cloudflare Zone | 9c70206ce57d506d1d4e9397f6bb8ebc |

---

## 🔄 After You Build

1. Update DEPLOYED.yml if you deployed anything
2. Commit to GitHub: `git add -A && git commit -m "description" && git push`
3. Add to error-playbook.md if you hit/solved new errors
4. Add to snippets/ if you wrote reusable API code
