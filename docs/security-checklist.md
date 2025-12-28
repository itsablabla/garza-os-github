# Security Hardening Checklist

> Critical security items identified from Dec 2024 audit

---

## 🔴 IMMEDIATE (Do Now)

### MCP Endpoints Exposed Without Protection
These endpoints have `proxied=false` in Cloudflare, meaning no WAF:

| Subdomain | Record ID | Action |
|-----------|-----------|--------|
| lastrock-mcp.garzahive.com | Check CF dashboard | Enable proxy |
| lrlab-mcp.garzahive.com | Check CF dashboard | Enable proxy |
| home-mcp.garzahive.com | Check CF dashboard | Enable proxy |

```bash
# Enable proxy via API
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/9c70206ce57d506d1d4e9397f6bb8ebc/dns_records/{record_id}" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"proxied": true}'
```

### SSH Bastion Hardened ✅
- fail2ban installed and active
- Password auth disabled
- Audit logging enabled
- IP: 143.198.190.20

### Remaining Servers Need Hardening
Run from Mac (network access required):
```bash
./scripts/ssh/master-hardening.sh
```

Targets: 16 servers listed in infra/hosts.yml

---

## 🟡 HIGH PRIORITY (This Week)

### Enable 2FA on All Accounts
| Service | Status | URL |
|---------|--------|-----|
| DigitalOcean | ⏳ | cloud.digitalocean.com/account/security |
| Cloudflare | ⏳ | dash.cloudflare.com/profile/authentication |
| GitHub | ⏳ | github.com/settings/security |
| Fly.io | ⏳ | fly.io/user/two-factor |
| n8n Cloud | ⏳ | Check settings |

### Migrate Secrets from Craft to Doppler
Craft doc 7061 contains plaintext credentials - security risk.

```bash
# Install Doppler CLI
brew install dopplerhq/cli/doppler

# Login
doppler login

# Create project
doppler projects create garza-os

# Import secrets
doppler secrets set FLYIO_TOKEN="..."
doppler secrets set CF_API_TOKEN="..."
# etc.
```

Priority secrets to migrate:
- Fly.io tokens (3 variants found)
- Cloudflare API tokens
- Claude API key
- UniFi Protect API keys
- ProtonMail bridge credentials

### Rotate Exposed Keys
Found in archived scripts/old configs:
- Old GitHub PAT tokens
- Exposed API keys in git history

```bash
# Check for secrets in git history
git log -p | grep -i "api_key\|token\|password" | head -50
```

---

## 🟢 MEDIUM PRIORITY (This Month)

### API Key Rotation Schedule
| Service | Rotation Period | Last Rotated |
|---------|-----------------|--------------|
| Fly.io | Monthly | Dec 2024 |
| GitHub PAT | Never (use SSH) | N/A |
| Cloudflare | Quarterly | Check |
| Claude API | Quarterly | Check |
| UniFi | Annually | Check |

### Supabase Vault Audit
112 secrets across 18 categories found.
Review and consolidate:
```sql
SELECT name, description, created_at 
FROM vault.secrets 
ORDER BY created_at DESC;
```

### Network Segmentation
- MCP servers should not have direct database access
- Use API layers between services
- Implement rate limiting on all endpoints

---

## Security Scripts

### Quick Health Check
```bash
#!/bin/bash
# scripts/security-check.sh

echo "=== Checking exposed endpoints ==="
for domain in lastrock-mcp lrlab-mcp home-mcp; do
  proxied=$(dig +short $domain.garzahive.com | grep -c "104.") 
  if [ "$proxied" -eq 0 ]; then
    echo "⚠️  $domain.garzahive.com NOT proxied"
  else
    echo "✅ $domain.garzahive.com proxied"
  fi
done

echo ""
echo "=== Checking SSH auth methods ==="
for ip in 143.198.190.20 192.241.139.240 68.183.108.79; do
  pw_auth=$(ssh -o BatchMode=yes -o ConnectTimeout=5 root@$ip "grep PasswordAuthentication /etc/ssh/sshd_config" 2>/dev/null)
  echo "$ip: $pw_auth"
done
```

### Fail2ban Status
```bash
# Check on any server
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

---

## Incident Response

### If API Key Compromised
1. Rotate immediately in source system
2. Update in Doppler/Vault
3. Update in running services (Fly secrets, Worker secrets)
4. Check logs for unauthorized access
5. Document in CHANGELOG.md

### If Server Compromised
1. Isolate: `doctl compute droplet-action power-off <id>`
2. Snapshot for forensics: `doctl compute droplet-action snapshot <id>`
3. Check other servers for lateral movement
4. Rebuild from clean image
5. Rotate all credentials that were on server

---

## Monitoring

### GitHub Action for Security Scanning
See `.github/workflows/security-scan.yml` (to create)

### Alerts Configured
- Pushcut for infrastructure failures
- n8n for workflow failures
- Need: Security-specific alerting

---

## References
- Craft doc 7061: Current credentials (migrate out)
- Craft doc 17348: MCP audit
- infra/hosts.yml: Server inventory
- scripts/ssh/master-hardening.sh: Hardening script
