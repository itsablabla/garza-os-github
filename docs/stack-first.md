# Stack First

**Before building anything new, check if the existing stack can do it.**

---

## The Stack

| Layer | Tool | Use For |
|-------|------|---------|
| **Hosting** | Fly.io | Containers, MCP servers, APIs |
| **Serverless** | Cloudflare Workers | Cron jobs, webhooks, light APIs |
| **Automation** | n8n Cloud | Workflows, integrations, triggers |
| **Database** | Supabase | Postgres, auth, secrets vault |
| **Code/CI** | GitHub | Version control, Actions, deploys |
| **Knowledge** | Craft | Docs, memory, source of truth |

---

## Decision Matrix

### "I need to store data"
```
→ Supabase Postgres (structured data)
→ Supabase Storage (files/blobs)
→ Cloudflare KV (key-value, fast reads)
→ Cloudflare R2 (S3-compatible objects)
```
**NOT**: SQLite files, JSON files on disk, new database service

### "I need to run code on a schedule"
```
→ n8n Cloud workflow with cron trigger
→ Cloudflare Worker with cron trigger
→ GitHub Actions (if repo-related)
```
**NOT**: Cron on VPS, launchd on Mac, new scheduler service

### "I need to respond to a webhook"
```
→ n8n Cloud webhook node
→ Cloudflare Worker
→ Fly.io app (if complex/stateful)
```
**NOT**: Express server on VPS, new endpoint service

### "I need to call external APIs"
```
→ n8n Cloud (visual, easy auth)
→ Cloudflare Worker (fast, edge)
→ Fly.io (if needs secrets/state)
```
**NOT**: Scripts on Mac, cron + curl

### "I need to deploy a service"
```
→ Fly.io (containers, scaling, secrets)
→ Cloudflare Workers (serverless, no cold start)
```
**NOT**: DigitalOcean, AWS, new VPS

### "I need to automate a workflow"
```
→ n8n Cloud (complex logic, many steps)
→ GitHub Actions (code/deploy related)
→ Zapier (only if n8n can't do it)
```
**NOT**: Custom scripts, new automation platform

### "I need secrets/credentials"
```
→ Supabase Vault (via CF MCP:get_secret)
→ Fly.io secrets (for Fly apps)
→ GitHub Secrets (for Actions)
```
**NOT**: .env files, hardcoded, Craft docs (legacy)

### "I need to process data/ETL"
```
→ n8n Cloud workflow
→ Supabase Edge Functions
→ Cloudflare Worker (light transforms)
```
**NOT**: Python scripts on Mac, new ETL tool

---

## Integration Patterns

### n8n ↔ Supabase
```
n8n has native Supabase nodes
- Supabase node for CRUD
- Postgres node for raw SQL
- Webhook → Supabase → Response
```

### n8n ↔ Fly.io
```
n8n HTTP Request node → Fly app endpoint
Fly app webhook → n8n webhook URL
```

### GitHub ↔ Fly.io
```
Push to main → GitHub Action → flyctl deploy
Already configured in .github/workflows/
```

### Supabase ↔ Fly.io
```
Fly app reads SUPABASE_URL + SUPABASE_KEY from secrets
Use @supabase/supabase-js in Node apps
```

### Cloudflare ↔ Supabase
```
Worker fetches from Supabase REST API
Worker uses service_role key for admin ops
```

---

## Anti-Patterns (Don't Do This)

| Instead of... | Use... |
|---------------|--------|
| New Postgres instance | Supabase |
| New Redis instance | Cloudflare KV or Supabase |
| Cron job on Mac | n8n or CF Worker cron |
| Manual deploys via SSH | GitHub Actions → Fly |
| Storing secrets in code | Supabase Vault or Fly secrets |
| One-off VPS for small task | Cloudflare Worker |
| Building custom auth | Supabase Auth |
| File storage on disk | Supabase Storage or R2 |

---

## Quick Reference

| Need | First Choice | Command/Action |
|------|--------------|----------------|
| Deploy container | Fly.io | `flyctl deploy` |
| Cron job | n8n Cloud | Create workflow with Schedule trigger |
| Webhook endpoint | n8n Cloud | Create workflow with Webhook trigger |
| Store secret | Supabase | `CF MCP:set_secret` (if implemented) |
| Get secret | Supabase | `CF MCP:get_secret name="x"` |
| Database table | Supabase | Dashboard or `d1_database_query` |
| File storage | Supabase/R2 | `r2_bucket_create` |
| CI/CD | GitHub Actions | `.github/workflows/` |

---

## The Rule

> **If the stack can do it, use the stack.**
> 
> Don't spin up new services. Don't install new tools.
> Map the need to existing infrastructure first.
