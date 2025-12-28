# Changelog

All notable changes to GARZA OS infrastructure.

## [v0.8.1] - 2025-12-27 (Home Automation Docs)

### Added
- `docs/integrations/unifi-protect.md` - Comprehensive UniFi Protect + Home Assistant setup guide
- `stacks/boulder-home/config/blueprints/automation/unifi-protect-motion-light.yaml` - Motion-activated light blueprint
- `stacks/boulder-home/config/blueprints/automation/unifi-doorbell-notify.yaml` - Doorbell notification blueprint

### Changed
- `stacks/boulder-home/README.md` - Updated with UniFi Protect integration instructions and secrets template


### Added - GitHub Actions
- `.github/workflows/daily-digest.yml` - 7 AM daily: infrastructure status, MCP health, n8n stats, security reminders
- `.github/workflows/cost-tracking.yml` - Monthly: Fly.io, DigitalOcean, services cost breakdown with savings opportunities
- `.github/workflows/token-rotation.yml` - Weekly: check token validity, rotation reminders, automated testing
- `.github/workflows/infrastructure-status.yml` - Every 30 min: generate STATUS.md with live service status

### Changed
- `docs/error-playbook.md` - Added sections:
  - UniFi Protect issues (rate limiting, local network, RTSP)
  - Container egress issues (wrangler, npm limitations)
  - Security exposures table with specific fixes needed
  - Updated known broken things table

### Infrastructure Monitoring
- Automated status badge generation via STATUS.md
- MCP server health checks with latency tracking
- Fly.io and Cloudflare Worker status tracking
- External services (n8n, Octelium) monitoring

### Automation
- Token validity testing (Fly.io, n8n)
- Cost estimation with savings recommendations
- Pushcut notifications for failures and digests

---

## [v0.7.0] - 2025-12-27 (Audit v2)

### Added - GitHub Actions
- `.github/workflows/auto-heal.yml` - Every 15 min: health check MCPs, auto-restart Fly apps, check n8n failures
- `.github/workflows/security-scan.yml` - Daily: scan for secrets, check endpoint protection, SSH security

### Added - Documentation
- `docs/security-checklist.md` - Critical security items from Dec 2024 audit with action items
- `docs/quick-reference.md` - One-page cheat sheet for all key info
- `docs/tool-knowledge/patterns.md` - Patterns learned from real usage (Beeper, Fly, n8n, Cloudflare, etc.)

### Changed
- `docs/error-playbook.md` - Major expansion: added auth errors, n8n errors, SSH relay issues, VoiceNotes issues, known broken things
- `DEPLOYED.yml` - Complete rewrite with audit findings: 
  - Added tools_count for MCP servers
  - Added retire/keep status for MCP consolidation
  - Added GitHub Actions section
  - Added security section with exposed endpoints
  - Added n8n cloud workflows count (28)
  - Fixed repo URL

### Security Identified
- Exposed MCP endpoints without Cloudflare proxy
- Plaintext secrets in Craft doc 7061 (migrate to Doppler)
- 16 servers need hardening script
- 2FA needed on all cloud accounts

### Infrastructure Status
- MCP consolidation: 12 → 4 servers (Craft, CF MCP, Garza Home, Last Rock Dev)
- n8n: cloud production at garzasync.app.n8n.cloud (28 workflows)
- Local n8n: DELETED Dec 26
- Fly apps: 13 total (8 active, 5 suspended/on-demand)

---

## [v0.6.0] - 2025-12-27

### Added - Major Improvements

#### Scripts
- `scripts/health-check.sh` - Pre-session health check for all systems
- `scripts/sync-deployed.sh` - Sync DEPLOYED.yml with live infrastructure  
- `scripts/discover-drift.sh` - Find undocumented services and drift

#### Runbooks
- `docs/runbooks/add-mcp-tool.md` - Step-by-step: add tool to MCP server
- `docs/runbooks/create-n8n-workflow.md` - Step-by-step: create n8n workflow
- `docs/runbooks/deploy-fly-app.md` - Step-by-step: deploy to Fly.io
- `docs/runbooks/add-supabase-table.md` - Step-by-step: create Supabase table
- `docs/runbooks/debug-mcp-connection.md` - Troubleshooting MCP failures

#### Documentation
- `docs/session-protocol.md` - Formalized session start/end procedures
- `docs/graphiti-guide.md` - How to use Graphiti knowledge graph
- `docs/secrets-consolidation.md` - Plan to consolidate secrets in Supabase

#### Templates
- `templates/n8n/webhook-to-response.json` - Webhook workflow starter
- `templates/n8n/scheduled-api-call.json` - Cron job workflow starter
- `templates/n8n/health-monitor.json` - System monitoring workflow
- `templates/cf-worker/basic-api.js` - Cloudflare Worker API starter
- `templates/cf-worker/wrangler.toml` - Worker config template
- `templates/supabase/basic-table.sql` - Standard table with RLS
- `templates/supabase/audit-table.sql` - Audit logging table

### Changed
- `README.md` - Complete rewrite with clear structure and quick reference
- Added runbooks directory for procedural documentation

### Philosophy
This release completes the transformation from reactive to proactive documentation:
- **Health checks** catch issues before they derail sessions
- **Runbooks** provide step-by-step guides for common tasks
- **Session protocol** formalizes best practices
- **Templates** eliminate starting from scratch
- **Drift detection** keeps docs in sync with reality

---

## [v0.5.1] - 2025-12-27

### Added
- `docs/stack-first.md` - Decision matrix for using existing stack (Fly.io, n8n, Supabase, GitHub, CF Workers)
- Stack summary table in preflight checklist
- "Building something new?" as first decision tree branch

### Changed
- `docs/claude-preflight.md` - Now routes to stack-first.md before any new build
- Added anti-patterns section to prevent spinning up new services

### Philosophy
> If the stack can do it, use the stack.

---

## [v0.5.0] - 2025-12-27

### Added
- **docs/claude-preflight.md** - Pre-flight checklist to read BEFORE starting any task
- **docs/credentials-index.md** - Quick lookup for all API keys with vault names
- **docs/curl-examples.md** - Tested, copy-paste ready curl commands

### Changed
- README.md rewritten to point to preflight doc first
- Emphasized proactive guardrails over reactive documentation

### Purpose
Prevents wasted tool calls by providing:
- Decision tree for server/tool selection
- Credential locations without hunting
- Common mistakes to avoid
- Tested commands instead of guessing syntax

---

## [0.4.0] - 2025-12-27

### Added
- `.github/workflows/sync-deployed.yml` - Auto health checks every 6 hours
- `docs/fallback-diagram.md` - Mermaid decision trees for all tool cascades
- `scripts/generate-snippet-index.sh` - Auto-generate snippet documentation
- `templates/snippets/INDEX.md` - Auto-generated snippet reference
- `DEPLOYED.yml` metadata section with version and health check timestamp

### Changed
- README.md completely rewritten with quick-reference table
- Better structure documentation

---

## [0.3.0] - 2025-12-27

### Added
- `DEPLOYED.yml` - Single source of truth for all deployments
- `docs/error-playbook.md` - Error → fix decision tree
- `templates/snippets/supabase-vault.js` - Vault secret lookup
- `templates/snippets/fly-api.js` - Fly.io machine management
- `templates/snippets/cloudflare-api.js` - DNS and worker management
- `templates/snippets/protonmail.js` - Email operations via Bridge

### Changed
- Improved documentation structure

---

## [0.2.0] - 2025-12-27

### Added
- `templates/fly-node-mcp/` - Standard MCP server template
- `scripts/deploy-fly.sh` - Automated Fly deployment
- `scripts/add-domain.sh` - DNS + cert automation
- `docs/fallback-patterns.md` - Tool execution cascades
- `docs/mcp-routing.md` - Server capability mapping
- `scripts/exec-fallback.sh` - Bash fallback executor

### Changed
- README with Claude-first checklist

---

## [0.1.0] - 2025-12-26

### Added
- Initial repo structure
- Boulder Home stack (Home Assistant, MQTT)
- Cloudflare worker templates
- GitHub Actions for deployment
- MCP registry documentation
- Secrets inventory structure

---

## Versioning

- **Major** (X.0.0): Breaking changes to structure or patterns
- **Minor** (0.X.0): New templates, scripts, or docs
- **Patch** (0.0.X): Fixes and small updates
