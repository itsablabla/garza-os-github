# SSH Redundancy Scripts

Smart SSH connection tools with automatic fallback and recovery.

## Scripts

### `connect.sh` - Smart SSH Connector
Tries all connection paths from `infra/hosts.yml` automatically.

**Usage:**
```bash
./connect.sh <hostname> [command]
```

**Examples:**
```bash
# Test connection
./connect.sh garzahive

# Run command
./connect.sh garzahive "uptime"

# Check Docker containers
./connect.sh garzahive "docker ps"
```

**Connection Strategy:**
1. Primary: Direct SSH to host
2. Fallback 1: SSH via relay/jump host
3. Fallback 2: MCP tool (lrlab-mcp or cf-mcp)
4. Fallback 3: API-based recovery

**Supported Hosts:**
- `garzahive` - DigitalOcean VPS (64.227.106.134)
- `mac` - Remote Mac via CF Tunnel (ssh.garzahive.com)
- `boulder` - Mac mini Boulder (boulder-ssh.garzahive.com)
- `n8n` - N8N VPS (167.172.147.240)
- `octelium` - Zero trust gateway (68.183.108.79)

---

### `test-all-paths.sh` - Health Check All SSH
Tests connectivity to all configured hosts.

**Usage:**
```bash
# Human-readable output
./test-all-paths.sh

# JSON output (for automation)
./test-all-paths.sh --json
```

**Output:**
```
=========================================
  SSH PATH HEALTH CHECK
=========================================

Testing garzahive...
✓ garzahive: Connected (2s)

Testing mac...
✓ mac: Connected (1s)

Testing boulder...
✓ boulder: Connected (3s)

Testing n8n...
✓ n8n: Connected (2s)

Testing octelium...
✓ octelium: Connected (2s)

=========================================
  SUMMARY
=========================================
Total:  5
Passed: 5
Failed: 0

All SSH paths operational ✓
```

**Use Cases:**
- Manual health check before operations
- Scheduled health monitoring (cron)
- GitHub Actions health checks
- Pre-deployment validation

---

### `auto-recover.sh` - Automatic SSH Recovery
Attempts to fix broken SSH connections automatically.

**Usage:**
```bash
./auto-recover.sh <hostname>
```

**Example:**
```bash
./auto-recover.sh garzahive
```

**Recovery Steps:**
1. Simple reconnect attempt
2. Network connectivity check (ping)
3. Service restart via API (if available)
4. Fallback path attempts
5. Manual intervention suggestions

**Output:**
```
=========================================
  SSH AUTO-RECOVERY
=========================================

[INFO] Starting recovery for garzahive...
[STEP] 1/4 Attempting simple reconnect...
[WARN] Simple reconnect failed
[STEP] 2/4 Checking network connectivity...
[INFO] ✓ Host is responding to ping
[STEP] 3/4 Attempting SSH service restart via DO API...
[WARN] DigitalOcean API restart not yet implemented
[STEP] 4/4 Checking if any fallback paths work...
[INFO] ✓ Recovery successful via fallback path!

=========================================
Recovery successful ✓
=========================================
```

**Recovery Strategies by Host:**

**garzahive:**
1. Simple reconnect
2. Ping test
3. DO API restart (not yet implemented)
4. Fallback paths

**mac:**
1. Simple reconnect
2. CF Tunnel check
3. Local shell execution

**boulder:**
1. Simple reconnect
2. Local network fallback (192.168.4.81)
3. Manual intervention

**n8n / octelium:**
1. Simple reconnect
2. DO API check (not yet implemented)

---

## Integration with Infrastructure State

These scripts read connection config from:
- `/infra/hosts.yml` - SSH connection matrix
- `/infra/services.yml` - Service health checks

Before running operations:
```bash
# Test all paths first
./test-all-paths.sh

# If any fail, attempt recovery
./auto-recover.sh <failed-host>

# Then proceed with operation
```

## Future Enhancements

- [ ] MCP tool fallback implementation (Python wrapper)
- [ ] DigitalOcean API integration for restart
- [ ] Automatic retry with exponential backoff
- [ ] Notification on failure (Beeper/email)
- [ ] Connection metrics logging
- [ ] Smart path selection based on latency

## See Also

- `/infra/hosts.yml` - Connection configuration
- `/docs/runbooks/debug-ssh.md` - SSH troubleshooting guide
