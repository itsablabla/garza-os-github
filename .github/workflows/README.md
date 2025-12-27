# GARZA OS GitHub Actions Workflows

GitHub Actions as the control plane for GARZA OS infrastructure. Zero dependency on CF MCP or local SSH.

## 🎯 Core Workflows

### 1. **deploy-fly-app.yml**
Deploy any Fly.io application.

**Inputs:**
- `app_name` (required): Fly app name (e.g., `garza-home-mcp`)
- `dockerfile_path` (optional): Custom Dockerfile path
- `region` (optional): Fly region (default: `dfw`)
- `skip_health_check` (optional): Skip post-deployment health check

**Example:**
```
App: garza-home-mcp
Region: dfw
Skip Health Check: false
```

### 2. **deploy-worker.yml**
Deploy Cloudflare Workers.

**Inputs:**
- `worker_name` (required): Worker name (e.g., `voicenotes-webhook`)
- `worker_path` (optional): Custom path to worker code
- `environment` (optional): `production` or `staging`

**Example:**
```
Worker: voicenotes-webhook
Environment: production
```

### 3. **ssh-execute.yml**
Execute commands on remote servers via SSH.

**Inputs:**
- `host` (required): Target host (`garzahive`, `mac`, `n8n`, `boulder`, `octelium`)
- `command` (required): Command to execute
- `timeout` (optional): Timeout in seconds (default: 300)

**Example:**
```
Host: garzahive
Command: docker ps
```

### 4. **update-state.yml**
Update infrastructure state files via GitHub API.

**Inputs:**
- `file` (required): State file (`deployments`, `operations`, `health`)
- `app_name` (optional): App/service name
- `status` (optional): New status
- `operation_type` (optional): Operation type for logging
- `custom_json` (optional): Custom JSON to merge

**Example:**
```
File: deployments
App Name: garza-home-mcp
Status: active
```

### 5. **health-check.yml**
Automated health checks for all services.

**Schedule:** Runs every 5 minutes automatically
**Manual Trigger:** Yes

Checks all MCP servers and Workers defined in `infra/services.yml`, saves results as artifacts.

### 6. **orchestrate.yml**
Multi-workflow orchestration for complex operations.

**Inputs:**
- `operation` (required): Operation type
  - `deploy-all-mcps`: Deploy all MCP servers
  - `deploy-all-workers`: Deploy all Workers
  - `full-system-deploy`: Deploy entire infrastructure
  - `restart-all-services`: Restart all Docker containers
  - `emergency-rollback`: Emergency rollback (manual)

**Example:**
```
Operation: deploy-all-mcps
```

## 🔐 Required Secrets

Add these to GitHub repository secrets (Settings → Secrets and variables → Actions):

**Fly.io:**
- `FLY_API_TOKEN`: Fly.io API token

**Cloudflare:**
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID

**SSH Keys:**
- `SSH_KEY_GARZAHIVE`: Private key for garzahive server
- `SSH_KEY_MAC`: Private key for Mac
- `SSH_KEY_N8N`: Private key for n8n server
- `SSH_KEY_OCTELIUM`: Private key for octelium server

## 📋 How Claude Uses This

### Deploy an app:
```python
trigger_workflow('deploy-fly-app.yml', {
    'app_name': 'garza-home-mcp',
    'region': 'dfw'
})
```

### Run SSH command:
```python
trigger_workflow('ssh-execute.yml', {
    'host': 'garzahive',
    'command': 'docker ps'
})
```

### Update deployment state:
```python
trigger_workflow('update-state.yml', {
    'file': 'deployments',
    'app_name': 'garza-home-mcp',
    'status': 'active'
})
```

### Deploy everything:
```python
trigger_workflow('orchestrate.yml', {
    'operation': 'full-system-deploy'
})
```

## 🎁 Benefits

**Zero CF MCP dependency:**
- Mac offline? ✅ Works
- SSH broken? ✅ Don't care  
- MCP down? ✅ Irrelevant

**Built-in features:**
- Automatic retries
- Full operation logs
- Parallel execution
- Scheduled jobs
- State synchronization

**Always accessible:**
- From any device
- Any Claude interface
- No local dependencies

## 📊 Monitoring

**View workflow runs:**
https://github.com/jadengarza/garza-os/actions

**Health check results:**
Stored as artifacts, retained for 7 days

**State files:**
Always in sync via `infra/state/*.json`

## 🔧 Maintenance

**Add new service:**
1. Add to `infra/services.yml`
2. Deploy via appropriate workflow
3. State auto-updates

**Update secrets:**
1. Go to repository Settings → Secrets
2. Update secret value
3. Re-run failed workflows if needed

**Emergency access:**
If GitHub Actions is down (extremely rare), use:
- Fly.io CLI directly
- Cloudflare Dashboard
- Direct SSH (if available)
