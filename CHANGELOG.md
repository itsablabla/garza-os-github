# Changelog

All notable changes to GARZA OS infrastructure.

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

## [0.5.0] - 2025-12-27

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
