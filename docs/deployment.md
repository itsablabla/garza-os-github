# Deployment Guide

**Updated: 2025-12-26**

## Fly.io Deployment

### Prerequisites
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"

# Login
fly auth login
```

### Standard Deployment Flow

1. **Create app**
```bash
fly apps create [app-name] --org personal
```

2. **Deploy**
```bash
fly deploy --ha=false
```

3. **Set secrets**
```bash
flyctl secrets set KEY1=value1 KEY2=value2 -a [app-name]
```

4. **Create volume (if needed)**
```bash
fly volumes create [name] --size 1 --region dfw -a [app-name]
```

### fly.toml Template
```toml
app = "your-app-name"
primary_region = "dfw"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[mounts]
  source = "data"
  destination = "/data"
```

### Custom Domain Setup

1. **Add DNS in Cloudflare**
```bash
# A record
curl -X POST "https://api.cloudflare.com/client/v4/zones/[zone-id]/dns_records" \
  -H "X-Auth-Email: jadengarza@pm.me" \
  -H "X-Auth-Key: [api-key]" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"subdomain","content":"66.241.124.34","ttl":1,"proxied":false}'
```

2. **Add cert to Fly**
```bash
fly certs add subdomain.garzahive.com -a [app-name]
fly certs check subdomain.garzahive.com -a [app-name]
```

**Important:** Set `proxied: false` in Cloudflare - Fly handles SSL.

---

## Cloudflare Workers Deployment

### Using Wrangler
```bash
npx wrangler deploy

# With secrets
npx wrangler secret put SECRET_NAME
```

### wrangler.toml Template
```toml
name = "worker-name"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
PUBLIC_VAR = "value"

[[kv_namespaces]]
binding = "KV_NAME"
id = "kv-namespace-id"

[[d1_databases]]
binding = "DB"
database_name = "db-name"
database_id = "db-id"
```

---

## Cloudflare Tunnel Setup

### Config Location
```
~/.cloudflared/config.yml
```

### Example Config
```yaml
tunnel: [tunnel-uuid]
credentials-file: /Users/customer/.cloudflared/[tunnel-uuid].json

ingress:
  - hostname: ha.garzahive.com
    service: http://127.0.0.1:8123
  - hostname: beeper-mcp.garzahive.com
    service: http://127.0.0.1:23373
  - service: http_status:404
```

### Commands
```bash
# Create tunnel
cloudflared tunnel create [name]

# Run tunnel
cloudflared tunnel run [name]

# DNS record (CNAME to tunnel)
cloudflared tunnel route dns [name] subdomain.garzahive.com
```

**Important:** Use `127.0.0.1` not `localhost` to avoid IPv6 issues.

---

## Docker Deployments

### Standard Dockerfile Pattern
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

### Docker Compose for Home Stack
```yaml
version: '3.8'
services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    network_mode: host
    volumes:
      - ./config:/config
    restart: unless-stopped
    
  mediamtx:
    image: bluenviron/mediamtx:latest
    network_mode: host
    volumes:
      - ./mediamtx.yml:/mediamtx.yml
    restart: unless-stopped
```

---

## MCP Server Deployment

### Standard MCP Server Pattern
```javascript
import express from 'express';
const app = express();
const API_KEY = process.env.API_KEY;

// SSE endpoint
app.get('/sse', (req, res) => {
  if (req.query.key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid key' });
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const sid = crypto.randomUUID();
  res.write(`data: /messages?sessionId=${sid}&key=${req.query.key}\n\n`);
});

// Messages endpoint
app.post('/messages', (req, res) => {
  if (req.query.key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid key' });
  }
  // Handle tool calls...
});

app.listen(8080);
```

### MCP Connection URL Format
```
https://[app].fly.dev/sse?key=[api-key]
```

---

## GitHub Sync

### After MCP Server Changes
```bash
cd /Users/customer/garza-os-github
./sync.sh
git add -A
git commit -m "description of changes"
git push
```

---

## Common Issues

### Fly.io Region Redirect
Denver (den) is deprecated → auto-redirects to Dallas (dfw). Update fly.toml accordingly.

### Volume Mount Failures
Existing machines without volume mounts need destruction before redeployment:
```bash
fly machines list -a [app-name]
fly machines destroy [machine-id] -a [app-name]
fly deploy
```

### Cloudflare DNS Propagation
After adding records, wait 30-60 seconds before cert validation. Use:
```bash
dig subdomain.garzahive.com
```

### MCP Server Not Exposing Tools
Server connection ≠ tool availability. Debug:
1. Check `/health` endpoint
2. Verify API key authentication
3. Check tool registration in server code
