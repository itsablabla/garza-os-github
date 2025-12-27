# Runbook: Debug MCP Connection Failure

## Symptoms
- MCP tools not responding
- SSE connection drops
- "Connection refused" errors
- Timeout errors

## Quick Diagnosis

### 1. Check if server is running
```bash
# For Fly.io hosted
flyctl status -a SERVER_NAME
flyctl logs -a SERVER_NAME --no-tail

# For local (Mac)
curl http://localhost:PORT/health
```

### 2. Check SSE endpoint
```bash
# Should return event stream or hang (waiting for events)
curl -N "https://SERVER.fly.dev/sse?key=API_KEY"

# Or for local
curl -N "http://localhost:PORT/sse"
```

### 3. Check health endpoint
```bash
curl https://SERVER.fly.dev/health
# Should return 200 with status
```

## Common Issues

### Server not running (Fly.io)
```bash
# Check machine status
flyctl machines list -a SERVER_NAME

# If stopped, start it
flyctl machines start MACHINE_ID -a SERVER_NAME

# Or trigger via HTTP (auto-start)
curl https://SERVER.fly.dev/health
```

### Wrong API key
```bash
# Get correct key from vault
CF MCP:get_secret name="server_mcp_key"

# Compare with what you're using
```

### SSL/TLS issues
```bash
# Test without SSL verification (debug only)
curl -k https://SERVER.fly.dev/health

# Check cert
openssl s_client -connect SERVER.fly.dev:443 -servername SERVER.fly.dev
```

### Port mismatch
```bash
# Check fly.toml internal_port matches app
grep internal_port fly.toml

# Check app listens on that port
grep -r "listen\|PORT" src/
```

### Memory/CPU exhaustion
```bash
# Check resource usage
flyctl logs -a SERVER_NAME | grep -i "memory\|oom\|killed"

# Scale up if needed
flyctl scale memory 512 -a SERVER_NAME
```

## Fallback Chain

If primary MCP fails:

```
1. CF MCP:shell_exec → 500 error
   ↓
2. CF MCP:ssh_exec host=mac
   ↓
3. SSH Back Up:ssh_exec host=192.168.4.81
   ↓
4. Telnet Back Up:telnet_exec
```

## Recovery Steps

### Restart Fly app
```bash
flyctl apps restart SERVER_NAME
```

### Redeploy
```bash
cd /path/to/server
flyctl deploy -a SERVER_NAME
```

### Check logs for root cause
```bash
flyctl logs -a SERVER_NAME | tail -100
```

### Verify after fix
```bash
# Health check
curl https://SERVER.fly.dev/health

# Tool call
curl -X POST https://SERVER.fly.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```
