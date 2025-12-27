# GARZA OS

Jaden's unified AI infrastructure. MCP servers, configs, automation.

---

## 🚨 CLAUDE: READ THIS FIRST

| Doc | Purpose |
|-----|---------|
| **[docs/claude-preflight.md](docs/claude-preflight.md)** | Pre-flight checklist - READ BEFORE STARTING |
| [docs/credentials-index.md](docs/credentials-index.md) | Where to find API keys |
| [docs/curl-examples.md](docs/curl-examples.md) | Tested copy-paste commands |
| [docs/error-playbook.md](docs/error-playbook.md) | Error → Fix mappings |
| [docs/fallback-diagram.md](docs/fallback-diagram.md) | Tool cascade decision trees |
| [DEPLOYED.yml](DEPLOYED.yml) | What's running where |
| [templates/snippets/INDEX.md](templates/snippets/INDEX.md) | Reusable API patterns |

---

## Structure

```
garza-os/
├── docs/                    # Documentation
│   ├── claude-preflight.md  # ⭐ START HERE
│   ├── credentials-index.md # API key lookup
│   ├── curl-examples.md     # Tested commands
│   ├── error-playbook.md    # Error solutions
│   └── fallback-diagram.md  # Decision trees
├── mcp-servers/             # MCP server source code
├── services/                # Fly.io services
├── workers/                 # Cloudflare Workers
├── templates/               # Starters & snippets
│   ├── fly-mcp/             # Fly.io MCP template
│   ├── cf-worker/           # CF Worker template
│   └── snippets/            # API code patterns
├── scripts/                 # Deployment helpers
├── configs/                 # System configs
├── DEPLOYED.yml             # Deployment manifest
└── CHANGELOG.md             # Version history
```

---

## Quick Commands

```bash
# After making changes
cd /Users/customer/garza-os-github
git add -A && git commit -m "description" && git push

# Search for existing code
grep -r "keyword" .

# Check what's deployed
cat DEPLOYED.yml
```

---

## Key Endpoints

| Service | URL |
|---------|-----|
| Garza Home MCP | https://garza-home-mcp.fly.dev/sse |
| n8n Cloud | https://garzasync.app.n8n.cloud |
| CF Zone (garzahive.com) | 9c70206ce57d506d1d4e9397f6bb8ebc |

---

## Version

Current: v0.4.0 - See [CHANGELOG.md](CHANGELOG.md)
