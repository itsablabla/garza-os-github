# Deployment Guide

## GitHub Actions Setup

### Required Secrets

Add these secrets to the repo (Settings → Secrets → Actions):

| Secret | Description | Where to get it |
|--------|-------------|-----------------|
| `FLY_API_TOKEN` | Fly.io API token | `flyctl tokens create deploy` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Cloudflare dashboard → API Tokens |

### Auto-Deploy Triggers

| Server | Trigger |
|--------|---------|
| garza-home-mcp | Push to `mcp-servers/garza-home-mcp/**` |
| beeper-matrix-mcp | Push to `mcp-servers/beeper-matrix-mcp/**` |
| garza-cloud-mcp | Push to `mcp-servers/garza-cloud-mcp/**` |

### Manual Deploy

1. Go to Actions tab in GitHub
2. Select the workflow
3. Click "Run workflow"
4. Select which server to deploy

---

## Manual Deployment

### Fly.io Servers

```bash
cd mcp-servers/garza-home-mcp
flyctl deploy
```

### Cloudflare Worker

```bash
cd mcp-servers/garza-cloud-mcp
npx wrangler deploy
```

### CF MCP (Mac)

CF MCP runs locally on the Mac Mini. To update:

```bash
cd /Users/customer/mcp-server
# Pull latest from repo
git pull
# Restart the service
pm2 restart mcp-server
```

---

## Environment Variables

### garza-home-mcp (Fly.io)

Set via `flyctl secrets set`:

```
BEEPER_PROXY_URL=...
BEEPER_TOKEN=...
PROTECT_URL=...
ABODE_USER=...
ABODE_PASS=...
GRAPHITI_URL=...
```

### garza-cloud-mcp (Cloudflare)

Set in wrangler.toml or via dashboard:

```
API_KEY=...
ADMIN_KEY=...
PROTECT_URL=...
BEEPER_PROXY_URL=...
BEEPER_TOKEN=...
```

---

## Syncing Local Changes to Repo

After making changes on the Mac:

```bash
cd /Users/customer/garza-os-github

# Copy updated files
cp /Users/customer/mcp-server/server.js mcp-servers/cf-mcp/
cp /Users/customer/garza-os-v2/garza-home-mcp/server.mjs mcp-servers/garza-home-mcp/

# Commit and push
git add -A
git commit -m "Update server code"
git push origin main
```
