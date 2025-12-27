# Runbook: Deploy New Fly.io App

## Prerequisites
- Fly CLI: `flyctl`
- Org token: `CF MCP:get_secret name="flyio_org_token"`

## Steps

### 1. Check if similar app exists
```bash
grep -i "keyword" /Users/customer/garza-os-github/DEPLOYED.yml
flyctl apps list
```

### 2. Create app directory
```bash
mkdir -p /Users/customer/garza-os-github/apps/new-app
cd /Users/customer/garza-os-github/apps/new-app
```

### 3. Use template if available
```bash
cp -r /Users/customer/garza-os-github/templates/fly-mcp/* .
# Or
cp -r /Users/customer/garza-os-github/templates/fly-node/* .
```

### 4. Create fly.toml
```toml
app = "new-app-name"
primary_region = "dfw"  # Always Dallas, not Denver

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

### 5. Create Dockerfile
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### 6. Set secrets
```bash
# Get from vault and set
flyctl secrets set API_KEY=xxx -a new-app-name
flyctl secrets set SUPABASE_URL=xxx -a new-app-name
```

### 7. Deploy
```bash
flyctl launch --no-deploy  # First time only
flyctl deploy
```

### 8. Verify
```bash
flyctl status -a new-app-name
flyctl logs -a new-app-name
curl https://new-app-name.fly.dev/health
```

### 9. Update docs
```bash
# Add to DEPLOYED.yml
# Commit to git
cd /Users/customer/garza-os-github
git add -A
git commit -m "Deploy new-app-name"
git push
```

## Common Issues

| Issue | Fix |
|-------|-----|
| Region error | Use `dfw` not `den` |
| Build fails | Check Dockerfile, ensure deps in package.json |
| OOM | Increase memory in fly.toml |
| Cold start slow | Set min_machines_running = 1 |
