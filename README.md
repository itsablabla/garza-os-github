# GARZA OS

Jaden Garza's unified AI operating system - personal infrastructure, MCP servers, and intelligence layer.

## Architecture

```
GARZA OS
├── mcp-servers/           # Model Context Protocol servers
│   ├── cf-mcp/            # Main brain - Mac orchestration, SSH gateway
│   ├── garza-home-mcp/    # Home automation (Fly.io)
│   ├── garza-cloud-mcp/   # Cloudflare Worker - KV, R2, D1
│   ├── unifi-protect-mcp/ # Camera/security integration
│   ├── beeper-matrix-mcp/ # Unified messaging (Fly.io)
│   ├── protonmail-mcp/    # Encrypted email
│   └── abode-mcp/         # Security system
├── prompts/               # System prompts & personas
├── configs/               # Configuration files
└── docs/                  # Documentation
```

## MCP Server Division

| Server | Platform | Role |
|--------|----------|------|
| CF MCP | Mac Mini | Brain/orchestration/SSH gateway |
| Garza Home | Fly.io | Home automation, Beeper, Bible tools |
| Garza Cloud | Cloudflare | API gateway, data storage |
| Beeper Matrix | Fly.io | Unified messaging layer |

## Quick Start

Each MCP server has its own README with deployment instructions.

## Related

- **Craft** - Knowledge base (source of truth)
- **Beeper** - Unified messaging
- **Fly.io** - Edge deployments
- **Cloudflare** - Workers, KV, R2, D1
