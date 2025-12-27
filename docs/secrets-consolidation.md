# Secrets Consolidation

## Status: ✅ COMPLETE

**Supabase Vault: 112 secrets organized by category**

## Categories in Vault

| Category | Count | Examples |
|----------|-------|----------|
| account | 25 | airbnb, apple, chatgpt, quickbooks, unifi |
| ai | 5 | claude_api, openai_api, deepgram_api, perplexity_api |
| analytics | 6 | airtable, fivetran, hightouch |
| communication | 7 | beeper, discord, twilio, gmail |
| craft | 1 | craft_api_endpoint |
| database | 3 | postgres passwords, n8n encryption |
| development | 5 | netlify, softr, bolt_ai |
| ecommerce | 12 | chargebee (7 keys), shopify, stripe |
| email | 3 | PA email accounts |
| infrastructure | 7 | cloudflare, digitalocean, fly.io |
| mcp | 8 | All MCP server keys |
| memory | 7 | mem.ai, supermemory, zep |
| n8n | 6 | All n8n instances |
| recovery | 2 | E2EE seed, proton recovery |
| server | 2 | matrix, maubot |
| shipping | 2 | shipstation |
| smart_home | 7 | UniFi APIs, hoobs |
| supabase | 4 | Vault project keys |

## Access Pattern

```javascript
// From any MCP server or service
const secret = await vault.getSecret('chargebee_full_access');

// Via CF MCP
CF MCP:get_secret({ name: 'claude_api' })

// Categories can be listed
CF MCP:list_secrets({ category: 'ai' })
```

## Migration Notes

- ✅ All API keys migrated from Craft doc 7061
- ✅ All MCP keys in vault
- ✅ All infrastructure tokens centralized
- ✅ Fly.io secrets reference vault (via CF MCP at deploy time)
- ⚠️ Some .env files on servers may have local copies (acceptable for boot)

## Security Best Practices

1. **Never commit secrets to git** - Use vault references
2. **Rotate regularly** - Especially MCP keys, API tokens
3. **Audit access** - Check vault logs periodically
4. **Minimal permissions** - Use scoped tokens when available

---
*Last verified: 2025-12-27*
