# GARZA OS

Infrastructure, templates, and automation for the GARZA OS ecosystem.

---

## 🤖 CLAUDE: READ THIS FIRST

Before building anything, check these resources:

| Need | Check |
|------|-------|
| Building new MCP/service | `templates/` folder |
| Tool failing with errors | `docs/error-playbook.md` |
| Tool routing questions | `docs/mcp-routing.md` |
| Visual fallback flows | `docs/fallback-diagram.md` |
| Deploying to Fly.io | `scripts/deploy-fly.sh` |
| Adding custom domain | `scripts/add-domain.sh` |
| What's deployed where | `DEPLOYED.yml` |
| Code snippets | `templates/snippets/INDEX.md` |

---

## 📁 Structure

```
├── DEPLOYED.yml          # 🎯 Single source of truth - all running services
├── CHANGELOG.md          # Version history
├── templates/
│   ├── snippets/         # Reusable code patterns (with INDEX.md)
│   ├── fly-node-mcp/     # MCP server template
│   ├── fly-python-mcp/   # Python MCP template
│   └── cloudflare-worker/# Worker template
├── scripts/
│   ├── deploy-fly.sh     # Automated Fly deployment
│   ├── add-domain.sh     # DNS + cert setup
│   ├── exec-fallback.sh  # Command with auto-fallback
│   ├── health-check.sh   # Manual health checks
│   └── generate-snippet-index.sh
├── docs/
│   ├── error-playbook.md # Error → Fix guide
│   ├── fallback-diagram.md # Visual decision trees
│   ├── fallback-patterns.md# Text-based cascades
│   ├── mcp-routing.md    # Server capabilities
│   └── mcp-registry.md   # Full MCP documentation
├── workers/              # Cloudflare Workers source
├── stacks/               # Docker Compose stacks
├── configs/              # Configuration files
├── prompts/              # AI prompts and personas
└── .github/workflows/    # CI/CD automation
```

---

## 🚀 Quick Start

### Deploy new MCP to Fly.io
```bash
cp -r templates/fly-node-mcp my-new-mcp
cd my-new-mcp
# Edit server.js with your tools
../scripts/deploy-fly.sh my-new-mcp
```

### Add custom domain
```bash
./scripts/add-domain.sh api my-app-name
# Creates api.garzahive.com → my-app-name.fly.dev
```

### Check what's deployed
```bash
cat DEPLOYED.yml
```

---

## 🔧 GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `sync-deployed.yml` | Every 6h / Manual | Health check all services |
| `deploy-fly.yml` | Push to workers/ | Auto-deploy Fly apps |
| `deploy-cloudflare.yml` | Push to workers/ | Auto-deploy CF Workers |
| `health-check.yml` | Manual | On-demand health check |

---

## 📊 Health Status

Check the [Actions tab](../../actions) for latest health check results.

Last automated check timestamp is in `DEPLOYED.yml` under `metadata.last_health_check`.

---

## 🏷️ Versioning

```bash
# View current version
git describe --tags

# Rollback to previous version
git checkout v0.3.0
```

See `CHANGELOG.md` for version history.
