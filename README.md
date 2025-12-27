# GARZA OS

Jaden's unified AI infrastructure. MCP servers, services, configs, templates, and scripts.

---

## 🤖 CLAUDE: READ THIS FIRST

Before building anything new, check this repo:

1. **Building a new MCP?** → Use `templates/fly-node-mcp/`
2. **Tool failing?** → Check `docs/fallback-patterns.md`
3. **Which MCP reaches what?** → Check `docs/mcp-routing.md`
4. **Deploying to Fly?** → Use `scripts/deploy-fly.sh`
5. **Adding a domain?** → Use `scripts/add-domain.sh`

**After building anything:**
```bash
cd /Users/customer/garza-os-github
git add -A && git commit -m "description" && git push
```

---

## Structure

```
garza-os/
├── mcp-servers/            # MCP server code
│   ├── cf-mcp/             # Brain - Mac orchestration
│   ├── garza-home-mcp/     # Home automation
│   ├── garza-cloud-mcp/    # Cloudflare Workers
│   ├── beeper-matrix-mcp/  # Messaging integration
│   ├── unifi-protect-mcp/  # Camera integration
│   ├── protonmail-mcp/     # Email integration
│   └── lrlab-mcp/          # Last Rock Labs tools
│
├── services/               # Fly.io services
│   ├── garza-ears/         # Voice pipeline
│   ├── chat-watcher/       # Auto-responders
│   ├── morning-messages/   # Jessica morning love
│   ├── email-craft/        # Email→Craft pipeline
│   ├── voicenotes-webhook/ # Voicenotes processing
│   ├── jessica-bot/        # Jessica automation
│   ├── dashboard/          # Web dashboard
│   └── mcp-controller/     # MCP orchestration
│
├── workers/                # Cloudflare Workers
│   └── health-monitor/     # Health checks
│
├── stacks/                 # Docker compose stacks
│   └── boulder-home/       # Home server stack
│
├── templates/              # Copy-paste starters
│   ├── fly-node-mcp/       # Node.js MCP template
│   ├── fly-python-mcp/     # Python MCP template
│   └── cloudflare-worker/  # CF Worker template
│
├── scripts/                # Automation
│   ├── deploy-fly.sh       # Deploy to Fly.io
│   ├── add-domain.sh       # DNS + certs
│   ├── daily-bible.sh      # Bible verse cron
│   └── claude-remote.sh    # Remote Claude trigger
│
├── docs/                   # Reference
│   ├── fallback-patterns.md
│   ├── mcp-routing.md
│   ├── architecture.md
│   └── deployment.md
│
├── configs/                # System configs
│   ├── master-config.md
│   └── identity/
│
└── prompts/                # System prompts
    ├── jada-soul.md
    └── personas/
```

## Quick Reference

| Resource | Location |
|----------|----------|
| API Keys | Craft doc 7061 |
| IP List | Craft doc 9239 |
| Identity Map | Craft doc 6996 |
| Master Config | Craft doc 14219 |
| Jada Soul | Craft doc 14522 |

## Services Overview

| Service | Platform | Purpose |
|---------|----------|---------|
| CF MCP | Mac (local) | Brain/orchestration |
| Garza Home MCP | Fly.io | Home automation |
| Garza Ears | Fly.io | Voice pipeline |
| Chat Watcher | Mac (local) | Auto-responders |
| Morning Messages | Mac (cron) | Jessica love notes |
| Health Monitor | CF Workers | System health |

## Quick Commands

```bash
# Deploy new MCP
cd templates/fly-node-mcp
cp -r . ~/my-new-mcp
cd ~/my-new-mcp
../../scripts/deploy-fly.sh my-new-mcp

# Add custom domain
./scripts/add-domain.sh subdomain app-name

# Sync after changes
git add -A && git commit -m "update" && git push
```

---

*Built with 💜 by Jaden Garza*
