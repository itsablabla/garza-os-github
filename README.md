# GARZA OS

Personal AI operating system configuration, infrastructure, and tooling.

---

## 🤖 CLAUDE: READ THIS FIRST

| Priority | Document | Purpose |
|----------|----------|---------|
| 1️⃣ | [`docs/claude-preflight.md`](docs/claude-preflight.md) | **START HERE** - Decision trees, credentials, common mistakes |
| 2️⃣ | [`docs/stack-first.md`](docs/stack-first.md) | Use existing tools before building new |
| 3️⃣ | [`docs/session-protocol.md`](docs/session-protocol.md) | What to do at start/end of every session |
| 4️⃣ | [`DEPLOYED.yml`](DEPLOYED.yml) | What's running where |

---

## 📁 Structure

```
garza-os-github/
├── docs/
│   ├── claude-preflight.md      # 🎯 Pre-flight checklist
│   ├── stack-first.md           # Use existing tools first
│   ├── session-protocol.md      # Session start/end procedures
│   ├── credentials-index.md     # Where to find secrets
│   ├── curl-examples.md         # Tested API commands
│   ├── error-playbook.md        # Known errors + solutions
│   ├── fallback-diagram.md      # What to try when things fail
│   ├── graphiti-guide.md        # Knowledge graph usage
│   ├── secrets-consolidation.md # Secrets migration plan
│   └── runbooks/
│       ├── add-mcp-tool.md      # Add tool to MCP server
│       ├── create-n8n-workflow.md
│       ├── deploy-fly-app.md
│       ├── add-supabase-table.md
│       └── debug-mcp-connection.md
├── scripts/
│   ├── health-check.sh          # Verify all systems up
│   ├── sync-deployed.sh         # Update DEPLOYED.yml from live
│   └── discover-drift.sh        # Find undocumented services
├── templates/
│   ├── fly-mcp/                 # MCP server starter
│   ├── n8n/                     # Workflow templates
│   ├── cf-worker/               # Cloudflare Worker templates
│   └── supabase/                # Database schema templates
├── configs/                     # Configuration files
├── stacks/                      # Docker compose stacks
└── DEPLOYED.yml                 # Single source of truth for infra
```

---

## 🏗️ The Stack

| Layer | Tool | Use For |
|-------|------|---------|
| Hosting | **Fly.io** | Containers, MCP servers, APIs |
| Automation | **n8n Cloud** | Workflows, webhooks, cron |
| Database | **Supabase** | Postgres, auth, secrets vault |
| Serverless | **Cloudflare Workers** | Edge functions, cron |
| CI/CD | **GitHub Actions** | Auto-deploy on push |
| Knowledge | **Craft** | Docs, memory, source of truth |

**Rule**: If the stack can do it, use the stack. Don't spin up new services.

---

## 🚀 Quick Commands

```bash
# Health check all systems
./scripts/health-check.sh

# Find drift between docs and reality
./scripts/discover-drift.sh

# After making changes
git add -A && git commit -m "description" && git push
```

---

## 📍 Key Endpoints

| Service | URL |
|---------|-----|
| Garza Home MCP | https://garza-home-mcp.fly.dev |
| CF MCP | https://mcp-cf.garzahive.com |
| n8n Cloud | https://jadengarza.app.n8n.cloud |
| LRLab MCP | https://lrlab-mcp.fly.dev |

---

## 📋 After Building

1. Update `DEPLOYED.yml` if you deployed anything
2. Commit + push to GitHub
3. Add to `error-playbook.md` if you solved new errors
4. Add to `templates/` if you wrote reusable code
