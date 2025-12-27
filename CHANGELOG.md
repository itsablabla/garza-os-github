# Changelog

All notable changes to GARZA OS infrastructure.

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
