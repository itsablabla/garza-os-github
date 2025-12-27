# Fallback Execution Patterns

When a tool fails with 500 error, use this cascade:

## For Mac Commands

```
1. CF MCP:shell_exec          → Primary (runs on Mac directly)
2. CF MCP:ssh_exec host=mac   → If shell_exec fails
3. Garza Hive:ssh_exec        → Won't work (different network)
4. SSH Back Up:ssh_exec       → Needs full IP: 45.147.93.59
```

## For GarzaHive (DigitalOcean) Commands

```
1. CF MCP:ssh_exec host=garzahive     → Primary
2. Garza Hive MCP:execute_command     → Direct on server
3. SSH Back Up:ssh_exec host=134.122.8.40
```

## For Boulder Mac Mini (Home)

```
1. Desktop Commander (if local)        → Primary when Jaden is home
2. CF MCP:ssh_exec                     → If tunnel is up
3. Not reachable from cloud servers    → Different network
```

## Quick Reference IPs

| Host | IP | SSH User |
|------|-----|----------|
| Mac (Denver/Remote) | 45.147.93.59 | customer |
| GarzaHive-01 | 134.122.8.40 | root |
| Boulder Mac Mini | 192.168.50.147 | customer (local only) |
| UNVR (UniFi) | 192.168.10.49 | root (Boulder network) |

## When Everything Fails

1. Check if server is up: `curl -s https://[service].fly.dev/health`
2. Check Fly.io status: `flyctl status -a [app-name]`
3. Reboot via DO API if needed
4. Ask Jaden to run command locally
