# GARZA OS Operations

Operation templates for automated deployment, maintenance, and recovery.

## Overview

Operations are YAML manifests that codify common workflows. Each template defines:
- **Prerequisites** - What must be true before running
- **Steps** - Ordered actions to execute
- **Rollback** - What to do if something fails
- **Notifications** - Who/how to alert on success/failure

## Directory Structure

```
operations/
├── deploy/              # Deployment operations
│   ├── mcp-server.yml   # Deploy MCP server to Fly.io
│   ├── worker.yml       # Deploy Cloudflare Worker
│   └── ...
├── maintain/            # Maintenance operations
│   ├── restart-service.yml
│   ├── health-check.yml
│   └── ...
└── recovery/            # Auto-recovery playbooks
    ├── mcp-down.yml
    ├── ssh-lost.yml
    └── deploy-failed.yml
```

## Operation Template Structure

```yaml
operation:
  name: "operation_name"
  type: "deploy|maintain|recovery"
  description: "What this does"

parameters:
  param_name: ""          # Required parameters
  optional_param: "default"

prerequisites:
  - check: "description"
    command: "test command"
    expected: "result"

steps:
  - name: "step_name"
    type: "action_type"
    # ... step-specific config

rollback:
  on_failure:
    - name: "cleanup"
      type: "action"

notifications:
  on_success:
    - channel: "beeper"
      message: "Success message"
```

## Step Types

### Lock Management
```yaml
- type: "lock"
  resource: "service-name"
  metadata:
    operator: "claude"
    operation: "deploy"
```

```yaml
- type: "unlock"
  resource: "service-name"
  force: true  # Force release even if errors
```

### Git Operations
```yaml
- type: "git"
  command: "git pull origin main"
```

```yaml
- type: "git"
  commands:
    - "git add infra/state/"
    - "git commit -m 'Update state'"
    - "git push origin main"
```

### SSH Commands
```yaml
- type: "ssh_command"
  host: "garzahive"
  command: "docker ps"
  timeout: 30
  output: "container_list"
```

```yaml
- type: "ssh_command"
  host: "mac"
  directory: "/path/to/dir"
  commands:
    - "npm install"
    - "npm run build"
  timeout: 120
```

### State Management
```yaml
- type: "state_check"
  file: "infra/state/deployments.json"
  path: ".fly_apps.garza-home-mcp"
  action: "read"
  output: "current_state"
```

```yaml
- type: "state_update"
  file: "infra/state/deployments.json"
  updates:
    ".fly_apps.garza-home-mcp.status": "running"
    ".fly_apps.garza-home-mcp.last_deploy": "${current_date}"
```

### Health Checks
```yaml
- type: "health_check"
  method: "http"
  url: "https://service.fly.dev/health"
  expected_status: 200
  retries: 5
  retry_delay: 10
```

```yaml
- type: "health_check"
  service: "service-name"
  from_registry: true  # Uses config from services.yml
```

### Conditional Execution
```yaml
- type: "conditional"
  condition: "${platform} == 'fly.io'"
  steps:
    - type: "ssh_command"
      command: "flyctl deploy"
```

### Loops
```yaml
- type: "foreach"
  items: "${services}"
  as: "service"
  parallel: true
  max_concurrent: 10
  steps:
    - type: "health_check"
      service: "${service}"
```

### Delays
```yaml
- type: "delay"
  seconds: 30
  description: "Wait for service startup"
```

### Notifications
```yaml
- type: "notification"
  channel: "beeper"
  priority: "high"
  message: "Alert message"
```

## Deployment Operations

### Deploy MCP Server
**Template:** `deploy/mcp-server.yml`

**Usage:**
```python
deploy_mcp(
    app_name="garza-home-mcp",
    source_dir="/Users/customer/garza-os-github/mcp-servers/garza-home-mcp",
    region="dfw"
)
```

**Steps:**
1. Acquire lock
2. Pull latest state
3. Install dependencies
4. Deploy to Fly.io
5. Health check
6. Update state
7. Release lock

**Rollback:** Automatic `flyctl releases rollback` on failure

---

### Deploy Cloudflare Worker
**Template:** `deploy/worker.yml`

**Usage:**
```python
deploy_worker(
    worker_name="voicenotes-webhook",
    source_dir="/Users/customer/garza-os-github/workers/voicenotes-webhook"
)
```

**Steps:**
1. Acquire lock
2. Install dependencies
3. Deploy with wrangler
4. Optional health check
5. Update state
6. Release lock

**Note:** CF Workers don't support rollback - must redeploy previous version manually

## Maintenance Operations

### Restart Service
**Template:** `maintain/restart-service.yml`

**Usage:**
```python
restart_service(
    service_name="garza-home-mcp",
    platform="fly.io"
)

restart_service(
    service_name="mosquitto-mqtt",
    platform="docker",
    host="boulder"
)
```

**Supports:**
- Fly.io apps: `flyctl apps restart`
- Docker containers: `docker restart`
- Systemd services: `systemctl restart`

---

### Health Check
**Template:** `maintain/health-check.yml`

**Usage:**
```python
# Check specific services
health_check(services=["garza-home-mcp", "lrlab-mcp"])

# Check service group
health_check(service_group="mcp_core")

# Check and auto-restart unhealthy
health_check(service_group="mcp_core", auto_restart=true)
```

**Features:**
- Parallel health checks (up to 10 concurrent)
- Auto-restart failed services (optional)
- Alert on critical failures
- Generate health report

## Recovery Playbooks

### MCP Server Down
**Template:** `recovery/mcp-down.yml`

**Triggered by:** Health check failure (2+ consecutive)

**Recovery steps:**
1. Verify failure
2. Attempt restart
3. Check logs for errors
4. Redeploy if auto-enabled
5. Alert if all failed

**Usage:**
```python
recover_mcp_down(
    mcp_server="garza-home-mcp",
    auto_redeploy=true
)
```

---

### SSH Connection Lost
**Template:** `recovery/ssh-lost.yml`

**Triggered by:** SSH connection failure

**Recovery steps:**
1. Try fallback connection paths
2. Run auto-recovery script
3. Host-specific recovery (DO API reboot, etc.)
4. Alert if all failed

**Usage:**
```python
recover_ssh_lost(
    host="garzahive",
    critical=true
)
```

---

### Deploy Failed
**Template:** `recovery/deploy-failed.yml`

**Triggered by:** Deployment failure

**Recovery steps:**
1. Check deployment state
2. Rollback to previous version (Fly.io only)
3. Analyze failure logs
4. Cleanup locks and temp files
5. Optional: retry deployment

**Usage:**
```python
recover_deploy_failed(
    service="garza-home-mcp",
    platform="fly.io",
    error_type="health_check_failed",
    auto_rollback=true,
    retry_deploy=false
)
```

## Variable Substitution

Templates support variable substitution:

**Built-in variables:**
- `${current_date}` - YYYY-MM-DD
- `${current_timestamp}` - ISO 8601 timestamp
- `${current_time}` - HH:MM:SS

**Parameter variables:**
- Any parameter can be referenced: `${param_name}`

**Output variables:**
- Steps can output variables: `output: "var_name"`
- Reference in later steps: `${var_name}`

## Execution Flow

```
1. Load template
2. Validate prerequisites
3. Execute steps in order
   - If step fails:
     - Run rollback steps
     - Send failure notifications
     - Exit with error
4. Send success notifications
5. Log operation to operations.json
```

## Lock Protocol

**Why locks:** Prevent concurrent operations on same resource

**Lock file format:**
```
operator: claude
timestamp: 2025-12-27T11:30:00Z
operation: deploy
```

**Lock acquisition:**
```bash
echo "operator: claude, ts: $(date -u +%Y-%m-%dT%H:%M:%SZ)" > infra/state/locks/service.lock
git add infra/state/locks/service.lock
git commit -m "Lock: service deploy"
git push
```

**Lock release:**
```bash
rm infra/state/locks/service.lock
git add infra/state/locks/
git commit -m "Release lock: service"
git push
```

**Force unlock:** If operation crashes, locks can be force-released

## Creating New Operations

1. Copy existing template closest to your use case
2. Update operation metadata
3. Define parameters
4. Add prerequisites
5. Define steps
6. Add rollback logic
7. Configure notifications
8. Test manually first
9. Commit to repo

## Future Enhancements

- [ ] Python orchestrator to execute YAML templates
- [ ] GitHub Actions to run operations via webhook
- [ ] Concurrent operation queue manager
- [ ] Operation dependencies (run B after A completes)
- [ ] Dry-run mode to preview operations
- [ ] Operation history with timing metrics
- [ ] Template validation tool
- [ ] Auto-generate operations from patterns

## See Also

- `/infra/` - Infrastructure state files
- `/scripts/ssh/` - SSH redundancy scripts
- `/docs/runbooks/` - Manual operation guides
- `DEPLOYED.yml` - Human-readable deployment manifest
