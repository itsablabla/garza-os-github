# GARZA OS

Jaden's unified AI infrastructure. MCP servers, configs, templates, and scripts.

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
├── templates/              # Copy-paste starters
│   ├── fly-node-mcp/       # Node.js MCP template
│   ├── fly-python-mcp/     # Python MCP template
│   └── cloudflare-worker/  # CF Worker template
│
├── scripts/                # Automation
│   ├── deploy-fly.sh       # Deploy to Fly.io
│   ├── add-domain.sh       # DNS + certs
│   └── sync.sh             # Sync configs
│
├── docs/                   # Reference
│   ├── fallback-patterns.md
│   ├── mcp-routing.md
│   └── infra-map.md
│
├── configs/                # System configs
│   ├── master-config.md
│   └── identity/
│
└── mcp-servers/            # Deployed server code
    ├── cf-mcp/
    ├── garza-home-mcp/
    └── lrlab-mcp/
```

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

## MCP Servers

| Server | URL | Purpose |
|--------|-----|---------|
| CF MCP | localhost:3333 | Mac orchestration |
| Garza Home | garza-home-mcp.fly.dev | Home automation |
| Garza Hive | mcp.garzahive.com | VPS operations |
| LRLab | lrlab-mcp.fly.dev | Dev tools |
