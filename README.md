# GARZA OS

Personal AI operating system - unified intelligence platform for Jaden Garza.

## Quick Start

```bash
# Clone and setup
git clone https://github.com/itsablabla/garza-os.git
cd garza-os
./scripts/setup.sh

# Check everything is working
garza health
```

## CLI Commands

```bash
garza deploy <app>      # Deploy to Fly.io (home, lrlab, ears, beeper, n8n)
garza logs <app>        # Stream logs from an app
garza health            # Check all service health
garza restart <app>     # Restart an app
garza ssh <app>         # SSH into an app
garza status            # Show all app statuses
garza secret list <app> # List secrets for an app
garza sync              # Commit and push to GitHub
```

## Scripts

| Script | Purpose |
|--------|---------|
| `setup.sh` | Initial setup, install CLI, check deps |
| `deploy.sh` | Deploy all or specific apps |
| `test.sh` | Run integration tests |
| `rotate-secrets.sh` | Rotate all API keys |
| `costs.sh` | Show cost estimates |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      GARZA OS                                │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Fly.io Apps   │  CF Workers     │  Local Services         │
├─────────────────┼─────────────────┼─────────────────────────┤
│ garza-home-mcp  │ jessica-cron    │ UniFi Protect           │
│ lrlab-mcp       │ garza-mcp       │ Home Assistant          │
│ garza-ears      │ log-aggregator  │ Abode Security          │
│ beeper-mcp      │ health-monitor  │                         │
│ garza-n8n       │                 │                         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `deploy-fly.yml` | Push to mcp-servers/ or services/ | Auto-deploy Fly apps |
| `deploy-cloudflare.yml` | Push to workers/ | Auto-deploy CF workers |
| `health-check.yml` | Every 15 min | Monitor all services |
| `backup-craft.yml` | Daily 6 AM UTC | Backup Craft docs |
| `sync-deployed.yml` | Manual | Sync DEPLOYED.yml |

## Directory Structure

```
garza-os/
├── mcp-servers/          # MCP server implementations
│   ├── garza-home-mcp/   # Home automation + Beeper
│   ├── lrlab-mcp/        # Last Rock Labs tools
│   └── beeper-matrix-mcp/
├── services/             # Other Fly.io services
│   ├── garza-ears/       # Voice transcription
│   └── jessica-bot/      # Automated messaging
├── workers/              # Cloudflare Workers
│   └── log-aggregator/   # Centralized logging
├── configs/              # Configuration files
├── stacks/               # Docker stacks (Boulder home)
├── scripts/              # CLI and automation
├── docs/                 # Documentation
│   ├── claude-preflight.md
│   ├── stack-first.md
│   └── error-playbook.md
├── snippets/             # Reusable code patterns
├── backups/              # Automated backups
└── .github/workflows/    # CI/CD
```

## Environment Variables

Required secrets in GitHub:
- `FLY_API_TOKEN` - Fly.io deploy token
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token
- `PUSHCUT_API_KEY` - Pushcut notifications
- `CRAFT_MCP_URL` - Craft MCP endpoint (for backups)

## Key Documentation

- [Master Config](docs/master-config.md) - System configuration
- [MCP Registry](docs/mcp-registry.md) - All MCP servers
- [Tool Knowledge Base](docs/tool-knowledge-base.md) - Patterns and tips
- [DEPLOYED.yml](DEPLOYED.yml) - Service inventory
- [Error Playbook](docs/error-playbook.md) - Common fixes

## Development

```bash
# Run tests
./scripts/test.sh

# Deploy specific app
garza deploy home

# Check costs
./scripts/costs.sh

# Rotate secrets (dry run first)
./scripts/rotate-secrets.sh --dry-run
```

## Craft Integration

Key documents:
- Master Config: 14219
- Identity Map: 6996
- Jada Soul: 14522
- App Index: 16391
- API/Passwords: 7061

---

Built with 💜 by Jaden + Jada
