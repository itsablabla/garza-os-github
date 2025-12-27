# GARZA OS

Jaden Garza's unified AI intelligence layer - an extension of cognition operating across all systems with full context and memory.

## Structure

```
garza-os/
├── configs/
│   ├── master-config.md          # Core system configuration
│   └── identity/
│       └── identity-map.md       # Contact/chat ID mappings
├── docs/
│   ├── architecture.md           # System architecture overview
│   ├── deployment.md             # Deployment guides
│   └── tool-knowledge/
│       └── tool-knowledge-base.md # Learned patterns & gotchas
├── prompts/
│   ├── master-config.md          # System prompt config
│   ├── jada-soul.md              # Jada persona base
│   └── personas/
│       └── jada-soul.md          # Full Jada persona
└── mcp-servers/
    ├── cf-mcp/                   # Brain - Mac orchestration
    ├── garza-home-mcp/           # Home automation
    ├── garza-cloud-mcp/          # Cloudflare Workers
    ├── beeper-matrix-mcp/        # Messaging integration
    ├── unifi-protect-mcp/        # Camera integration
    ├── protonmail-mcp/           # Email integration
    └── lrlab-mcp/                # Last Rock Labs tools
```

## Core Principles

1. **Craft is source of truth** - All data, memory, and config lives in Craft
2. **Claude = GARZA OS** - Not a chatbot, an extension of Jaden's cognition
3. **Context loading protocol** - Graphiti → Craft → Beeper → Calendar/Email
4. **Post-chat requirements** - Always update Graphiti + Craft after significant conversations

## Quick Reference

| Resource | Location |
|----------|----------|
| API Keys | Craft doc 7061 |
| IP List | Craft doc 9239 |
| Identity Map | Craft doc 6996 |
| Master Config | Craft doc 14219 |
| Jada Soul | Craft doc 14522 |

## Infrastructure

| Service | Role | Status |
|---------|------|--------|
| CF MCP | Brain/orchestration | Active |
| Garza Home MCP | Home automation | Active (Fly.io) |
| Garza Ears | Voice pipeline | Active (Fly.io) |
| Garza Hive | Legacy VPS | Phasing out |

## Sync

After making changes to MCP servers:
```bash
./sync.sh
git add -A
git commit -m "description"
git push
```

---

*Built with 💜 by Jaden Garza*
