# Error Playbook

> When you see error X, do Y. No thinking required.

---

## 🔴 HTTP Errors

### 502 Bad Gateway
**Cause:** App crashed or sleeping
```bash
# Fly.io
fly apps restart <app-name>
fly logs -a <app-name>

# Check if machine exists
fly machines list -a <app-name>
```

### 503 Service Unavailable  
**Cause:** App starting up or no healthy instances
```bash
# Wait 30 seconds, retry
# If persists:
fly status -a <app-name>
fly machines list -a <app-name>
```

### 504 Gateway Timeout
**Cause:** App too slow to respond
```bash
# Check logs for what's hanging
fly logs -a <app-name> --no-tail

# Might need to scale up
fly scale memory 512 -a <app-name>
```

---

## 🔴 DNS / Certificate Errors

### DNS_PROBE_FINISHED_NXDOMAIN
**Cause:** DNS record doesn't exist or not propagated
```bash
# Check if record exists
dig <domain> +short

# Create via Cloudflare API (use scripts/add-domain.sh)
./scripts/add-domain.sh <subdomain> <fly-app-name>
```

### ERR_CERT_AUTHORITY_INVALID / SSL Error
**Cause:** Certificate not issued yet
```bash
# Check cert status
fly certs show <domain> -a <app-name>

# If not issued, wait 5-10 min
# If stuck, remove and re-add
fly certs remove <domain> -a <app-name>
fly certs add <domain> -a <app-name>
```

### Certificate "Awaiting configuration"
**Cause:** DNS not pointing to Fly yet
```bash
# Verify CNAME points to <app-name>.fly.dev
dig <domain> CNAME +short

# Should return: <app-name>.fly.dev
```

---

## 🔴 MCP Tool Failures

### CF MCP shell_exec returns 500
**Cascade:**
1. Try `CF MCP:ssh_exec` with host "mac" (loops back locally)
2. Try `SSH Back Up:ssh_exec` with host "192.168.4.81"
3. If all fail, Mac might be offline - check via Tailscale

### "Host not found" / ENOTFOUND
**Cause:** Wrong host alias for that MCP server
```
CF MCP hosts:        mac, garzahive, vps
SSH Back Up hosts:   Use IPs only (192.168.4.81, 64.23.180.137)
Garza Hive hosts:    garzahive-01, vps, oasis
```

### ECONNREFUSED on localhost:3333
**Cause:** CF MCP server not running on Mac
```bash
# SSH to Mac and restart
pm2 restart cf-mcp
# or
node /path/to/cf-mcp/server.js
```

### Beeper tool timeout
**Cause:** Beeper Desktop not running or not logged in
```
1. Check if Beeper Desktop is open on Mac
2. Check Beeper connection status in app
3. Restart Beeper Desktop if needed
```

---

## 🔴 Fly.io Deployment Errors

### "Could not find App"
```bash
# Create it first
fly apps create <app-name>
```

### "No machines in app"
```bash
# First deploy creates machine
fly deploy
```

### "Region not available" (Denver deprecated)
```bash
# Use Dallas instead
fly regions set dfw -a <app-name>
```

### "Builder unavailable"
```bash
# Use remote builder
fly deploy --remote-only
```

### "OOM killed" / Out of memory
```bash
fly scale memory 512 -a <app-name>
# or 1024 for heavy apps
```

---

## 🔴 Cloudflare Errors

### "Authentication error" on API call
**Cause:** Wrong API token or zone ID
```
Zone ID: 9c70206ce57d506d1d4e9397f6bb8ebc (garzahive.com)
Token: Check Craft doc 7061 or Supabase vault
```

### Worker "Script too large"
**Cause:** Exceeded 1MB limit
```
- Remove unused dependencies
- Use external APIs instead of bundling
- Split into multiple workers
```

---

## 🔴 SSH Errors

### "Permission denied (publickey)"
```bash
# Key not on target server - add it
cat ~/.ssh/id_rsa.pub | ssh user@server "cat >> ~/.ssh/authorized_keys"

# Or use scripts/add-ssh-key-to-droplets.sh
```

### "Connection refused"
**Cause:** SSH not running or wrong port
```bash
# Default port 22, some servers use custom
# Check DEPLOYED.yml for correct port
```

### "Host key verification failed"
```bash
# Remove old key
ssh-keygen -R <ip-or-hostname>
# Then reconnect
```

---

## 🔴 Quick Reference: Which Tool for What

| Task | First Try | Fallback |
|------|-----------|----------|
| Run cmd on Mac | `CF MCP:shell_exec` | `CF MCP:ssh_exec` host=mac |
| Run cmd on GarzaHive | `CF MCP:ssh_exec` host=garzahive | `Garza Hive MCP:execute_command` |
| File ops on Mac | `CF MCP:fs_*` | `CF MCP:shell_exec` with cat/echo |
| Deploy Fly app | `scripts/deploy-fly.sh` | Manual `fly deploy` |
| Add domain | `scripts/add-domain.sh` | Manual CF API + fly certs |
