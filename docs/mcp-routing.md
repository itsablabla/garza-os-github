# MCP Server Routing

## Which MCP Can Reach What

| MCP Server | Can Reach | Cannot Reach |
|------------|-----------|--------------|
| CF MCP | Mac (local), GarzaHive (SSH), Fly.io, Cloudflare | Boulder network |
| Garza Hive MCP | GarzaHive (local), Fly.io | Mac, Boulder |
| Garza Home MCP | Beeper, ProtonMail, Graphiti | UniFi (needs Boulder) |
| SSH Back Up | Any server with IP (no aliases) | - |
| Telnet Back Up | Same as SSH Back Up | - |

## MCP Tool Prefixes

| Prefix | Server | Primary Use |
|--------|--------|-------------|
| CF MCP: | Mac orchestrator | Shell, SSH, file ops, Cloudflare |
| Garza Hive MCP: | DO VPS | Server ops, backups |
| Garza Home MCP: | Fly.io | Home automation, messaging |
| Beeper Chat...: | Beeper Desktop | Messaging (via Mac) |
| Craft: | Craft API | Knowledge management |
| Cloudflare...: | CF API | Workers, D1, KV, R2 |

## SSH Host Aliases by Server

### CF MCP (~/mcp-server on Mac)
```
mac       → localhost (self)
garzahive → 134.122.8.40
```

### Garza Hive MCP (Fly relay)
```
garzahive     → 134.122.8.40
garzahive-01  → 134.122.8.40
garzahive-02  → (secondary if exists)
vps           → 134.122.8.40
oasis         → Oasis staging
lrlos         → Last Rock Labs
```

### SSH Back Up / Telnet Back Up
No aliases - use full IPs only:
```
root@134.122.8.40      → GarzaHive
customer@45.147.93.59  → Mac
```
