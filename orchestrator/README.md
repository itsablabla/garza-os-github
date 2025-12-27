# GARZA OS Orchestrator

Python execution engine for YAML operation templates. Handles deployment, maintenance, and recovery operations with proper queuing, state management, and error handling.

## Architecture

```
orchestrator/
├── orchestrator.py           # Main orchestrator - loads templates, executes steps
├── requirements.txt          # Python dependencies
├── core/
│   └── template_parser.py    # Parses YAML templates, validates, substitutes variables
├── managers/
│   ├── state_manager.py      # Reads/writes JSON state files
│   ├── lock_manager.py       # Git-based distributed locking
│   └── queue_manager.py      # Concurrent operation queue
└── executors/
    └── step_executor.py      # Executes individual step types
```

## Installation

```bash
cd /Users/customer/garza-os-github/orchestrator
pip install -r requirements.txt
```

## Quick Start

### Execute Single Operation

```bash
# Deploy MCP server
python orchestrator.py deploy/mcp-server app_name=garza-home-mcp source_dir=/path/to/source

# Restart service
python orchestrator.py maintain/restart-service service_name=garza-home-mcp platform=fly.io

# Health check
python orchestrator.py maintain/health-check service_group=mcp_core
```

### Use Queue for Concurrent Operations

```bash
# Start queue processor (in background)
python managers/queue_manager.py process 3 &

# Add operations to queue
python managers/queue_manager.py add deploy/mcp-server app_name=garza-home-mcp
python managers/queue_manager.py add maintain/health-check service_group=mcp_core

# Check queue status
python managers/queue_manager.py stats

# List operations
python managers/queue_manager.py list running
python managers/queue_manager.py list failed
```

## Components

### Orchestrator

**Main execution engine** - coordinates template parsing, prerequisite checking, step execution, rollback, and notifications.

**Features:**
- Loads YAML templates from `/operations`
- Validates prerequisites before execution
- Executes steps in order
- Handles rollback on failure
- Sends notifications (Beeper, log)
- Logs operations to `infra/state/operations.json`

**Usage:**
```python
from orchestrator import Orchestrator

orch = Orchestrator()

# Execute with parameters
success, result = orch.execute(
    'deploy/mcp-server',
    parameters={
        'app_name': 'garza-home-mcp',
        'source_dir': '/path/to/source',
        'region': 'dfw'
    }
)

# Dry run (validate only)
success, result = orch.execute(
    'deploy/mcp-server',
    parameters={'app_name': 'test'},
    dry_run=True
)
```

---

### Template Parser

**Parses and validates YAML templates** - handles variable substitution, parameter merging, and validation.

**Features:**
- Loads templates by name or path
- Validates required structure
- Merges parameters with defaults
- Substitutes variables: `${param}`, `${current_date}`, etc.
- Built-in variables: `current_date`, `current_timestamp`, `current_time`

**Usage:**
```python
from core.template_parser import TemplateParser

parser = TemplateParser('/Users/customer/garza-os-github')

# Load template
template = parser.load_template('deploy/mcp-server')

# Validate parameters
parser.validate_parameters(template, {'app_name': 'test'})

# Merge with defaults
params = parser.merge_parameters(template, {'app_name': 'test'})

# Substitute variables
final = parser.substitute_variables(template, params)
```

---

### State Manager

**Manages infrastructure state** - reads/writes JSON state files with atomic operations.

**Features:**
- Read/write entire state files
- Get/set values using JSON path notation
- Batch updates
- Append to operation log
- Atomic file writes (temp file + rename)

**Usage:**
```python
from managers.state_manager import StateManager

state = StateManager('/Users/customer/garza-os-github')

# Read value
status = state.get_value(
    'deployments.json',
    '.fly_apps.garza-home-mcp.status'
)

# Set value
state.set_value(
    'deployments.json',
    '.fly_apps.garza-home-mcp.status',
    'running'
)

# Batch update
state.update_values('deployments.json', {
    '.fly_apps.garza-home-mcp.status': 'running',
    '.fly_apps.garza-home-mcp.last_deploy': '2025-12-27'
})

# Append operation log
state.append_operation({
    'type': 'deploy',
    'target': 'garza-home-mcp',
    'status': 'success'
})
```

---

### Lock Manager

**Git-based distributed locking** - prevents concurrent operations on same resource.

**Features:**
- Acquire/release locks via Git commits
- Distributed coordination (multi-machine safe)
- Lock metadata (operator, timestamp, operation)
- Force unlock option
- Wait-for-lock with timeout

**Usage:**
```python
from managers.lock_manager import LockManager

locks = LockManager('/Users/customer/garza-os-github')

# Acquire lock
success = locks.acquire_lock(
    'garza-home-mcp',
    operator='claude',
    operation='deploy'
)

if not success:
    print("Resource locked by another operation")

# Check lock status
if locks.is_locked('garza-home-mcp'):
    info = locks.get_lock_info('garza-home-mcp')
    print(f"Locked by {info['operator']} at {info['timestamp']}")

# Release lock
locks.release_lock('garza-home-mcp')

# Wait for lock (with timeout)
success = locks.wait_for_lock(
    'garza-home-mcp',
    timeout=300,  # 5 minutes
    check_interval=5
)
```

---

### Queue Manager

**Concurrent operation queue** - manages parallel execution with priority scheduling.

**Features:**
- Priority-based queue (higher priority = earlier execution)
- Configurable max concurrent operations (default: 3)
- Thread-safe operation
- Operation status tracking (queued, running, success, failed)
- Cancel queued operations
- Queue statistics

**Usage:**
```python
from managers.queue_manager import OperationQueue

queue = OperationQueue(
    '/Users/customer/garza-os-github',
    max_concurrent=3
)

# Add operation
op_id = queue.add_operation(
    'deploy/mcp-server',
    {'app_name': 'garza-home-mcp'},
    priority=7  # Higher = sooner (default: 5)
)

# Start workers
queue.start_workers(num_workers=3)

# Check status
status = queue.get_operation_status(op_id)
print(status['status'])  # queued, running, success, failed

# List operations
all_ops = queue.list_operations()
running = queue.list_operations(OperationStatus.RUNNING)

# Get stats
stats = queue.get_stats()
print(f"Queued: {stats['queued']}, Running: {stats['running']}")

# Stop workers
queue.stop_workers()
```

---

### Step Executor

**Executes individual operation steps** - handles all step types with proper error handling.

**Supported Step Types:**

**Lock Management:**
```yaml
- type: lock
  resource: service-name
  metadata:
    operator: claude
    operation: deploy
```

**Git Operations:**
```yaml
- type: git
  command: git pull origin main

- type: git
  commands:
    - git add infra/state/
    - git commit -m "Update"
    - git push origin main
```

**SSH Commands:**
```yaml
- type: ssh_command
  host: garzahive
  command: uptime
  timeout: 30
  output: uptime_result
```

**State Management:**
```yaml
- type: state_check
  file: deployments.json
  path: .fly_apps.garza-home-mcp.status
  output: current_status

- type: state_update
  file: deployments.json
  updates:
    .fly_apps.garza-home-mcp.status: running
    .fly_apps.garza-home-mcp.last_deploy: ${current_date}
```

**Health Checks:**
```yaml
- type: health_check
  method: http
  url: https://service.fly.dev/health
  expected_status: 200
  retries: 5
  retry_delay: 10
```

**Conditional Execution:**
```yaml
- type: conditional
  condition: ${platform} == 'fly.io'
  steps:
    - type: ssh_command
      command: flyctl deploy
```

**Loops:**
```yaml
- type: foreach
  items: ${services}
  as: service
  steps:
    - type: health_check
      service: ${service}
```

**Delays:**
```yaml
- type: delay
  seconds: 30
  description: Wait for service startup
```

**Notifications:**
```yaml
- type: notification
  channel: beeper
  priority: high
  message: Deploy failed for ${app_name}
```

**Operation Logging:**
```yaml
- type: operation_log
  entry:
    type: deploy
    target: ${app_name}
    status: success
```

## Execution Flow

```
1. Load Template
   ↓
2. Validate Parameters
   ↓
3. Merge Parameters with Defaults
   ↓
4. Substitute Variables
   ↓
5. Check Prerequisites
   ↓
6. Execute Steps (in order)
   ├─ If step fails
   │  ├─ Execute Rollback Steps
   │  ├─ Send Failure Notifications
   │  └─ Return error
   ↓
7. Send Success Notifications
   ↓
8. Log Operation
   ↓
9. Return Success
```

## CLI Usage

### Direct Execution

```bash
# Basic execution
python orchestrator.py <template> [param=value ...]

# Examples
python orchestrator.py deploy/mcp-server app_name=garza-home-mcp
python orchestrator.py maintain/restart-service service_name=test platform=docker host=garzahive
python orchestrator.py recovery/mcp-down mcp_server=garza-home-mcp auto_redeploy=true
```

### Queue Management

```bash
# Add to queue
python managers/queue_manager.py add <template> [param=value ...]

# Check operation status
python managers/queue_manager.py status <operation_id>

# Cancel queued operation
python managers/queue_manager.py cancel <operation_id>

# List operations
python managers/queue_manager.py list              # All
python managers/queue_manager.py list queued       # Only queued
python managers/queue_manager.py list running      # Only running
python managers/queue_manager.py list success      # Completed successfully
python managers/queue_manager.py list failed       # Failed

# Queue statistics
python managers/queue_manager.py stats

# Process queue (blocking, Ctrl+C to stop)
python managers/queue_manager.py process [num_workers]
```

## Python API

### Execute Operation

```python
from orchestrator import Orchestrator

orch = Orchestrator()

# Simple execution
success, result = orch.execute(
    'deploy/mcp-server',
    {'app_name': 'garza-home-mcp'}
)

if success:
    print(f"Deploy completed in {result['duration_seconds']}s")
else:
    print(f"Deploy failed: {result['error']}")
```

### Use Queue

```python
from managers.queue_manager import OperationQueue
import time

queue = OperationQueue('/Users/customer/garza-os-github')

# Add operations
op1 = queue.add_operation('deploy/mcp-server', {'app_name': 'test1'}, priority=7)
op2 = queue.add_operation('deploy/mcp-server', {'app_name': 'test2'}, priority=5)
op3 = queue.add_operation('maintain/health-check', {'service_group': 'mcp_core'})

# Start processing
queue.start_workers(3)

# Wait for completion
while queue.get_stats()['running'] > 0 or queue.get_stats()['queued'] > 0:
    time.sleep(1)

queue.stop_workers()

# Check results
for op_id in [op1, op2, op3]:
    status = queue.get_operation_status(op_id)
    print(f"{op_id}: {status['status']}")
```

## Error Handling

### Automatic Rollback

If a step fails, the orchestrator automatically executes rollback steps:

```yaml
rollback:
  enabled: true
  on_failure:
    - name: rollback_deployment
      type: ssh_command
      command: flyctl releases rollback
    
    - name: release_lock
      type: unlock
      resource: ${service_name}
      force: true
```

### Continue on Failure

Steps can be marked to continue even if they fail:

```yaml
- name: optional_cleanup
  type: ssh_command
  command: rm -rf /tmp/old-files
  continue_on_failure: true
```

### Lock Cleanup

Failed operations automatically release locks in rollback phase. Force unlock available:

```python
locks.release_lock('resource-name', force=True)
```

## Integration with Infrastructure

### State Files

Orchestrator reads/writes these state files:
- `infra/state/deployments.json` - Current deployment state
- `infra/state/operations.json` - Operation history log
- `infra/state/locks/*.lock` - Resource locks

### SSH Scripts

Uses SSH redundancy scripts from Phase 2:
- `scripts/ssh/connect.sh` - Smart SSH with fallback paths
- `scripts/ssh/auto-recover.sh` - SSH recovery

### Operation Templates

Executes YAML templates from Phase 3:
- `operations/deploy/*.yml` - Deployment operations
- `operations/maintain/*.yml` - Maintenance operations
- `operations/recovery/*.yml` - Recovery playbooks

## Future Enhancements

- [ ] Web API for remote operation triggering
- [ ] Real-time operation progress streaming
- [ ] Beeper notification integration (currently just logs)
- [ ] Webhook support for external triggers
- [ ] Operation dependencies (run B after A)
- [ ] Scheduled operations (cron-like)
- [ ] Operation templates from HTTP URLs
- [ ] Prometheus metrics export
- [ ] Grafana dashboard for queue stats

## Troubleshooting

**Lock conflicts:**
```bash
# Check lock status
ls -la infra/state/locks/

# Force release
python -c "from managers.lock_manager import LockManager; LockManager('.').release_lock('resource', force=True)"
```

**Queue not processing:**
```bash
# Check stats
python managers/queue_manager.py stats

# Restart workers
# Kill existing process, then:
python managers/queue_manager.py process 3 &
```

**Operation failed:**
```bash
# Check operation log
cat infra/state/operations.json | jq '.operations[-10:]'

# Check specific operation
python managers/queue_manager.py status <operation_id>
```

## See Also

- `/operations/README.md` - Operation template documentation
- `/infra/` - Infrastructure state files
- `/scripts/ssh/` - SSH redundancy scripts
