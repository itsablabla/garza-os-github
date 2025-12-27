# Secrets Consolidation Plan

**Goal**: Single source of truth for all secrets in Supabase Vault.

---

## Current State (Messy)

| Location | What's There | Status |
|----------|--------------|--------|
| Supabase Vault | Most secrets | ✓ PRIMARY |
| Craft doc 7061 | Legacy API keys | ⚠️ DEPRECATE |
| Git configs | GitHub tokens | ⚠️ MIGRATE |
| Fly secrets | App-specific | ✓ KEEP (app-scoped) |
| .env files | Scattered | ❌ REMOVE |

---

## Target State (Clean)

```
┌─────────────────────────────────────────────┐
│           Supabase Vault                    │
│  (CF MCP:get_secret / CF MCP:list_secrets)  │
├─────────────────────────────────────────────┤
│  infrastructure/                            │
│    flyio_org_token                          │
│    cf_api_token                             │
│    cf_global_api_key                        │
│    digitalocean_token (legacy)              │
│    github_token                             │
│                                             │
│  ai/                                        │
│    claude_api                               │
│    openai_api_key                           │
│                                             │
│  mcp/                                       │
│    cf_mcp_key                               │
│    garza_home_mcp_key                       │
│    garzahive_mcp_key                        │
│    n8n_mcp_key                              │
│    beeper_mcp_key                           │
│                                             │
│  communication/                             │
│    beeper_remote                            │
│    protonmail_bridge                        │
│                                             │
│  n8n/                                       │
│    n8n_cloud_api                            │
│                                             │
│  supabase/                                  │
│    supabase_url                             │
│    supabase_anon_key                        │
│    supabase_service_key                     │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           Fly.io Secrets                    │
│      (App-scoped, set at deploy time)       │
├─────────────────────────────────────────────┤
│  Each app gets only what it needs:          │
│  - SUPABASE_URL                             │
│  - SUPABASE_KEY                             │
│  - API_KEY (for auth)                       │
│  - App-specific secrets                     │
└─────────────────────────────────────────────┘
```

---

## Migration Checklist

### Phase 1: Audit (Do First)
- [ ] Run `CF MCP:list_secrets` to see what's in vault
- [ ] Review Craft doc 7061 for any missing secrets
- [ ] Check git configs for tokens
- [ ] List all Fly app secrets: `flyctl secrets list -a <app>`

### Phase 2: Add Missing to Vault
```bash
# Example: Add GitHub token
CF MCP:set_state key="secret:github_token" value="ghp_xxx"

# Or via Supabase dashboard if set_state not implemented
```

### Phase 3: Update References
- [ ] Update credentials-index.md with final vault names
- [ ] Update preflight.md credential table
- [ ] Update any hardcoded references in scripts

### Phase 4: Deprecate Old Sources
- [ ] Archive Craft doc 7061 (don't delete yet)
- [ ] Remove .env files from repos
- [ ] Document git config tokens in vault

---

## Quick Reference After Migration

```bash
# Get any secret
CF MCP:get_secret name="flyio_org_token"
CF MCP:get_secret name="claude_api"
CF MCP:get_secret name="n8n_cloud_api"

# List by category
CF MCP:list_secrets category="infrastructure"
CF MCP:list_secrets category="mcp"
```

---

## Fly.io Secret Management

```bash
# Set secret for app
flyctl secrets set API_KEY=xxx -a garza-home-mcp

# List secrets
flyctl secrets list -a garza-home-mcp

# Import from vault (pattern)
TOKEN=$(CF MCP:get_secret name="some_token")
flyctl secrets set SOME_TOKEN=$TOKEN -a app-name
```

---

## Never Store Secrets In:
- Git repos (even private)
- Craft docs (except 7061 as legacy backup)
- .env files committed to repos
- Slack/Beeper messages
- Claude conversations (they're logged)
