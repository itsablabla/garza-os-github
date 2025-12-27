# Infrastructure State Management

This directory contains the single source of truth for GARZA OS infrastructure state.

## Purpose

Git becomes the database. Before any operation (deploy, restart, configure), check state here. After any operation, update state and commit. This prevents race conditions, enables concurrent operations with locking, and provides audit trail.

## Structure

```
/infra/
├── state/
│   ├── deployments.json      # Live deployment state
│   ├── operations.json        # Operation queue and history
│   └── locks/                 # Lock files (gitignored except .gitkeep)
├── hosts.yml                  # SSH connection matrix with fallbacks
├── services.yml               # Service registry with health checks
└── README.md                  # This file
```

## Files

### `state/deployments.json`
**Purpose:** Track what's deployed where  
**Updated by:** Deploy scripts, operation orchestrator  
**Schema:**
```json
{
  "fly_apps": {
    "app-name": {
      "status": "running|suspended|down",
      "url": "https://...",
      "region": "...",
      "last_deploy": "YYYY-MM-DD",
      "locked": false
    }
  },
  "cloudflare_workers": { ... },
  "mcp_servers": { ... },
  "vps_servers": { ... }
}
```

### `state/operations.json`
**Purpose:** Operation queue and audit trail  
**Updated by:** All operations  
**Schema:**
```json
{
  "queue": [
    {
      "id": "uuid",
      "type": "deploy|restart|update",
      "target": "service-name",
      "status": "queued|running|complete|failed",
      "started_at": "ISO timestamp",
      "completed_at": "ISO timestamp",
      "result": "success|failure",
      "logs": "..."
    }
  ],
  "history": [ ... ]
}
```

### `state/locks/`
**Purpose:** Prevent concurrent operations on same resource  
**Mechanism:** 
- Before operating on resource, create `locks/resource-name.lock`
- Lock file contains: operator, timestamp, operation type
- After operation, delete lock file
- Git commit/push provides distributed locking

### `hosts.yml`
**Purpose:** Complete SSH connection matrix with redundancy  
**Features:**
- Primary connection details
- Fallback paths (relay SSH, MCP tools, API)
- Health check commands
- Service inventory per host

### `services.yml`
**Purpose:** Service registry with health checks  
**Features:**
- All services across all platforms
- Health check methods (HTTP, SSH command)
- Dependencies
- Criticality flags
- Service groupings

## Usage Patterns

### Before Deploying
```bash
# Check if already deployed
cat state/deployments.json | jq '.fly_apps["my-app"]'

# Check if locked
ls state/locks/my-app.lock 2>/dev/null && echo "LOCKED" || echo "FREE"
```

### During Operation
```bash
# Acquire lock
echo "operator: claude, ts: $(date -u +%Y-%m-%dT%H:%M:%SZ)" > state/locks/my-app.lock
git add state/locks/my-app.lock && git commit -m "Lock: my-app deploy" && git push

# Do the operation
fly deploy ...

# Update state
jq '.fly_apps["my-app"].status = "running"' state/deployments.json > tmp && mv tmp state/deployments.json

# Release lock
rm state/locks/my-app.lock
git add state/ && git commit -m "Deploy complete: my-app" && git push
```

### Health Checking
```python
# Read services.yml
# For each critical service:
#   - Run health check
#   - If fails: log, alert, attempt recovery
#   - Update deployments.json with last_health_check
```

## Lock File Format

```
operator: <who/what is doing operation>
timestamp: <ISO 8601>
operation: <deploy|restart|update|...>
reason: <optional context>
```

## State Update Rules

1. **Always read before write** - Load current state from Git first
2. **Atomic updates** - Single commit per state change
3. **Descriptive commits** - "Deploy garza-home-mcp v2.1.0" not "update"
4. **Pull before push** - Handle merge conflicts if concurrent updates
5. **Lock for writes** - Create lock file for any mutating operation

## Benefits

- **Prevents duplicate deploys** - Check state first
- **Enables parallelism** - Lock only specific resources
- **Audit trail** - Git log shows every infrastructure change
- **Self-documenting** - State files + commits = full history
- **Recovery** - Can reconstruct what was deployed when
- **Coordination** - Multiple automation systems can cooperate via Git

## Next Steps

After infrastructure state is working:
1. SSH redundancy scripts (`/scripts/ssh/`)
2. Operation templates (`/operations/`)
3. Concurrent operation manager
4. GitHub Actions for self-healing

## See Also

- `/docs/architecture.md` - Overall system design
- `DEPLOYED.yml` - Human-readable deployment manifest (not used by automation)
