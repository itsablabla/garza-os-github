# GARZA OS Infrastructure State

This directory contains the single source of truth for all GARZA OS infrastructure state, enabling concurrent operations, automatic recovery, and stateful deployments.

## Directory Structure

```
/infra/
├── state/
│   ├── deployments.json      # Live deployment state (auto-updated)
│   ├── operations.json        # Operation queue and history
│   └── locks/                # Lock files for concurrent operations
├── hosts.yml                 # SSH connection matrix with fallbacks
├── services.yml              # Service catalog with health checks
└── README.md                 # This file
```

## Files

### state/deployments.json
**Purpose:** Live state of all deployed services  
**Updated:** Automatically after each deployment  
**Usage:** Check before deploying to avoid conflicts

```bash
# Before deploying
current_state=$(cat infra/state/deployments.json)
# Check if already deployed, what version, etc.
```

### state/operations.json
**Purpose:** Track operation queue and history  
**Contains:**
- `queue`: Operations waiting to execute
- `history`: Completed operations log
- `active_locks`: Currently locked resources

### state/locks/
**Purpose:** Prevent concurrent operations on same resource  
**Usage:** Create lock file before operation, delete after

```bash
# Acquire lock
touch infra/state/locks/fly-garza-home-mcp.lock
# ... do operation ...
rm infra/state/locks/fly-garza-home-mcp.lock
```

### hosts.yml
**Purpose:** Complete SSH connection matrix  
**Features:**
- Primary connection details
- Fallback paths (relay, MCP tools, API)
- Health check commands
- SSH key references

**Enables:** Automatic failover if primary SSH fails

### services.yml
**Purpose:** Catalog of all services  
**Contains:**
- Health check endpoints
- Dependencies
- Criticality flags
- Alert thresholds

**Enables:** Automated health monitoring and recovery

## Usage Patterns

### Before Deploying
```bash
# 1. Check current state
cat infra/state/deployments.json | jq '.fly_apps["garza-home-mcp"]'

# 2. Check for active locks
ls infra/state/locks/

# 3. Deploy if safe
```

### After Deploying
```bash
# 1. Update deployments.json
# 2. Add to operations.json history
# 3. Commit and push to GitHub
# 4. Remove any locks
```

### Concurrent Operations
```bash
# Safe: Different resources
deploy garza-home-mcp & deploy lrlab-mcp &

# Blocked: Same resource (lock prevents)
deploy garza-home-mcp & deploy garza-home-mcp &
```

## Auto-Update Strategy

GitHub Actions will automatically update these files:
- **On deployment:** Update `deployments.json` with new version/timestamp
- **On health check:** Update service status
- **On operation:** Log to `operations.json`

## Lock File Convention

Lock files use format: `{type}-{resource}.lock`

Examples:
- `fly-garza-home-mcp.lock` - Deploying Fly app
- `ssh-garzahive.lock` - SSH operation in progress
- `worker-voicenotes-webhook.lock` - Worker deployment

## State Consistency

All state files are version controlled and must be committed after updates:
```bash
git add infra/state/
git commit -m "Update: deployed garza-home-mcp v2.1"
git push
```

This ensures state is always synchronized across all systems.
