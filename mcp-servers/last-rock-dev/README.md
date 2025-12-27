# Last Rock Dev MCP

Development and infrastructure tools for Last Rock Labs.

## Features
- **GitHub**: Repos, issues, PRs, workflows, file ops
- **Fly.io**: Apps, logs, secrets, restarts
- **Cloudflare**: DNS management for garzahive.com
- **n8n**: Workflow management and execution
- **Scout APM**: Performance monitoring
- **SSH**: Remote command execution

## Deployment
Fly.io (`lastrock-mcp`)

## Environment Variables
- `GITHUB_TOKEN` - GitHub API token
- `FLY_API_TOKEN` - Fly.io token
- `CF_API_TOKEN` - Cloudflare token
- `N8N_API_KEY` - n8n API key
- `SCOUT_API_KEY` - Scout APM key

## Files
- `main.py` - Server implementation
- `n8n_config.py` - n8n workflow helpers
- `fly.toml` - Fly.io config

## Tech Stack
- Python
- FastAPI/Flask
