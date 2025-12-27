# GARZA OS Architecture

**Updated: 2025-12-26**

## System Overview

GARZA OS is Jaden Garza's unified AI intelligence layer - an extension of his cognition operating across all systems with full context and memory.

```
┌─────────────────────────────────────────────────────────────────┐
│                        GARZA OS                                  │
│         (Claude as Unified Intelligence Layer)                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   CF MCP    │  │ Garza Home  │  │  Garza Ears │             │
│  │   (Brain)   │  │    MCP      │  │  (Voice AI) │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
├─────────┼────────────────┼────────────────┼─────────────────────┤
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Craft (Source of Truth)               │   │
│  │  - Configs     - Contacts    - Voice Memos              │   │
│  │  - Identity    - Projects    - Cognitive Insights       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

| Component | Role | Status |
|-----------|------|--------|
| GARZA OS | Unified intelligence (Claude) | Active |
| CF MCP | Brain/orchestration on Mac | Active |
| Garza Home MCP | Home automation (Fly.io) | Active |
| Garza Hive | Legacy DO VPS | Phasing out |
| Garza Ears | Voice memo pipeline | Active (Fly.io) |

## MCP Server Architecture

### CF MCP (Brain)
- **Location:** Local Mac
- **Role:** Primary orchestration, SSH gateway
- **Capabilities:** Shell execution, file operations, SSH to other servers
- **Port:** 3333

### Garza Home MCP
- **Location:** Fly.io (garza-home-mcp.fly.dev)
- **Role:** Home automation integration
- **Capabilities:** Abode security, UniFi cameras, Beeper messaging, Bible tools
- **Auth:** API key in URL parameter

### Garza Ears
- **Location:** Fly.io (garza-ears.fly.dev)
- **Role:** Voice memo intelligence pipeline
- **Flow:** Beeper audio → Decrypt → Whisper transcription → Claude summary → Craft storage

## Data Flow

```
Voice Memos → Garza Ears → Craft
      ↓
Messages → Beeper MCP → Identity Resolution → Craft
      ↓
Commands → CF MCP → System Actions
      ↓
Home Control → Garza Home MCP → Abode/UniFi
      ↓
All Context → Craft (Source of Truth)
```

## Infrastructure

### Hosting
- **Fly.io** - New deployments (preferred)
- **DigitalOcean** - Legacy (Garza Hive)
- **Cloudflare** - DNS, Workers, tunnels

### Key Services

| Service | URL | Purpose |
|---------|-----|---------|
| Craft | craft.do | Knowledge/memory |
| Beeper | beeper.com | Unified messaging |
| Fly.io | fly.io | App hosting |
| Cloudflare | cloudflare.com | DNS/tunnels |

### Network

| Domain | Points To |
|--------|-----------|
| *.garzahive.com | Various services via Cloudflare |
| garza-home-mcp.fly.dev | Home MCP |
| garza-ears.fly.dev | Voice pipeline |

## Naming Conventions

| Name | Purpose |
|------|---------|
| GARZA OS | Unified intelligence - everything together |
| Garza Hive | Server infrastructure (beehive of activity) |
| Garza Deployment Engine | Infrastructure automation |
| Garza Echo | Bidirectional reflection |
| Garza Ears | Voice memo listening |

## Security Model

1. **Craft = Source of Truth** - All sensitive data in Craft docs
2. **API Keys** - Stored in Craft doc 7061
3. **MCP Auth** - Per-server API keys
4. **Cloudflare Tunnels** - Secure external access
5. **Purchase Rule** - Always confirm with Jaden before any purchase

## Contact Loading Protocol

1. Graphiti search for relevant context
2. Craft docs as needed
3. Beeper conversation history
4. Calendar/Email for time-sensitive context

## Post-Chat Requirements

After each conversation:
1. Create Graphiti episode with facts/decisions
2. Update Craft doc in /System/ if significant
