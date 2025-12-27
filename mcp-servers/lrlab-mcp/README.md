# Last Rock Labs Dev MCP

Development MCP server for Last Rock Labs infrastructure.

## Deployment
- **URL:** https://lrlab-mcp.fly.dev
- **SSE:** https://lrlab-mcp.fly.dev/sse?key=lrlab-dev-v2-a7c9e3f18b2d4e6f
- **Region:** SJC (San Jose)

## Tools (12)

### Core
| Tool | Description |
|------|-------------|
| `ping` | Health check |

### SSH (3)
| Tool | Description |
|------|-------------|
| `ssh_exec` | Execute command via SSH |
| `ssh_hosts` | List available SSH host aliases |

**Configured Hosts:**
- `garzahive` → 143.198.190.20 (root)
- `mac` → ssh.garzahive.com (customer)
- `n8n` → 167.172.147.240 (root)

### GitHub (5)
| Tool | Description |
|------|-------------|
| `github_list_repos` | List repos for user/org |
| `github_get_repo` | Get repository details |
| `github_list_issues` | List issues (open/closed/all) |
| `github_create_issue` | Create issue with title, body, labels |
| `github_create_repo` | Create new repo (private default) |

### Scout APM (4)
| Tool | Description |
|------|-------------|
| `scout_list_apps` | List monitored applications |
| `scout_get_app_endpoints` | Get endpoints with performance metrics |
| `scout_get_insights` | N+1 queries, memory bloat, slow queries |
| `scout_get_error_groups` | Recent error groups |

## Required Secrets
```bash
fly secrets set GITHUB_TOKEN=ghp_xxx
fly secrets set SCOUT_API_KEY=xxx
fly secrets set SSH_PRIVATE_KEY="$(cat ~/.ssh/id_rsa)"
```

## Deploy
```bash
cd mcp-servers/lrlab-mcp
fly deploy
```
