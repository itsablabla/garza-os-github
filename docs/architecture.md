# GARZA OS Architecture

## Overview

GARZA OS is a unified AI intelligence layer that operates across multiple platforms to provide Jaden with seamless operational support, automation, and intelligent assistance.

```
┌─────────────────────────────────────────────────────────────────┐
│                         GARZA OS                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │   Claude    │◄───│    Craft    │───►│   Beeper    │          │
│  │   (Brain)   │    │   (Memory)  │    │  (Comms)    │          │
│  └──────┬──────┘    └─────────────┘    └─────────────┘          │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────┐        │
│  │                 MCP Server Layer                      │        │
│  ├─────────────┬─────────────┬─────────────────────────┤        │
│  │   CF MCP    │ Garza Home  │   Garza Cloud           │        │
│  │   (Mac)     │  (Fly.io)   │   (Cloudflare)          │        │
│  │             │             │                         │        │
│  │ • SSH       │ • Beeper    │ • KV Storage            │        │
│  │ • Shell     │ • UniFi     │ • R2 Files              │        │
│  │ • Files     │ • Abode     │ • D1 Database           │        │
│  │ • Secrets   │ • Bible     │ • API Gateway           │        │
│  └─────────────┴─────────────┴─────────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Context Loading (Session Start)
1. Graphiti → Relevant historical context
2. Craft → Specific documents needed
3. Beeper → Recent conversation history
4. Calendar/Email → Time-sensitive context

### Memory Persistence (Session End)
1. Add Graphiti episode with facts/decisions
2. Create/update Craft doc if significant

## MCP Server Responsibilities

### CF MCP (Mac Mini)
**Role:** Brain and orchestration hub

- SSH gateway to all servers
- Shell command execution
- File system operations
- Secret management (Supabase vault)
- Computer Use containers
- Primary control plane

### Garza Home MCP (Fly.io)
**Role:** Home automation and messaging

- Beeper integration (unified messaging)
- UniFi Protect (cameras, events, snapshots)
- Abode security system
- Bible tools
- Graphiti knowledge graph

### Garza Cloud MCP (Cloudflare Worker)
**Role:** API gateway and data storage

- KV namespace operations
- R2 bucket file storage
- D1 database queries
- API key management
- Rate limiting
- Audit logging

## Redundancy

If any MCP server goes down, CF MCP can SSH directly to the underlying infrastructure to maintain operations.
