# GARZA OS Secrets Inventory

> **WARNING:** This file contains SECRET NAMES ONLY, not values.
> Actual secrets are stored in Supabase Vault or Craft doc 7061.

## Primary Vault: Supabase
- **Project:** garza-os-vault
- **URL:** https://vbwhhmdudzigolwhklal.supabase.co

---

## 🤖 AI & LLM
| Secret Name | Service | Context |
|-------------|---------|---------|
| `claude_api_key` | Anthropic Claude | all |
| `openai_api_key` | ChatGPT | all |
| `perplexity_api_key` | Perplexity | all |
| `deepgram_api_key` | Speech-to-Text | voicenotes |
| `skyvern_api_key` | Browser Automation | automation |

## 💬 Communication
| Secret Name | Service | Context |
|-------------|---------|---------|
| `twilio_sid` | Twilio | sms |
| `twilio_secret` | Twilio | sms |
| `beeper_local_api` | Beeper Desktop | local |
| `beeper_remote_api` | Beeper Cloud | remote |
| `discord_bot_token` | Discord | automation |
| `gmail_app_password` | Gmail SMTP | email |
| `customerio_api` | Customer.io | marketing |

## 🧠 Memory & Knowledge
| Secret Name | Service | Context |
|-------------|---------|---------|
| `supermemory_family` | Supermemory | family |
| `supermemory_company` | Supermemory | work |
| `supermemory_jada` | Supermemory | jada |
| `zep_api_key` | Zep Memory | memory |
| `mem_ai_api_key` | Mem.ai | memory |

## 💳 E-commerce & Billing
| Secret Name | Service | Context |
|-------------|---------|---------|
| `shopify_api_key` | Shopify | ecommerce |
| `shopify_secret` | Shopify | ecommerce |
| `shopify_admin_token` | Shopify Admin | ecommerce |
| `chargebee_full_access` | Chargebee | billing |
| `chargebee_mcp_lookup` | Chargebee MCP | billing |
| `stripe_finta` | Stripe | payments |
| `stripe_n8n` | Stripe | automation |

## 📊 Data & Analytics
| Secret Name | Service | Context |
|-------------|---------|---------|
| `airtable_key_1` | Airtable | data |
| `airtable_key_2` | Airtable | data |
| `fivetran_api_key` | Fivetran | etl |
| `fivetran_api_secret` | Fivetran | etl |

## 📦 Shipping
| Secret Name | Service | Context |
|-------------|---------|---------|
| `shipstation_api_key` | ShipStation | shipping |
| `shipstation_api_secret` | ShipStation | shipping |

## ☁️ Infrastructure
| Secret Name | Service | Context |
|-------------|---------|---------|
| `digitalocean_token` | DigitalOcean | infra |
| `fly_org_token` | Fly.io | infra |
| `cloudflare_api_token` | Cloudflare | infra |
| `cloudflare_access_client_id` | CF Access | auth |
| `cloudflare_access_client_secret` | CF Access | auth |
| `supabase_service_role` | Supabase | database |
| `supabase_anon_key` | Supabase | database |

## 🔐 MCP Server Keys
| Secret Name | Service | Context |
|-------------|---------|---------|
| `cf_mcp_key` | CF MCP | mcp |
| `garza_hive_mcp_key` | Garza Hive MCP | mcp |
| `garza_home_mcp_key` | Garza Home MCP | mcp |
| `n8n_mcp_key` | n8n MCP | mcp |
| `ssh_backup_mcp_key` | SSH Backup MCP | mcp |
| `last_rock_dev_mcp_key` | Last Rock Dev MCP | mcp |

## 🏠 Smart Home
| Secret Name | Service | Context |
|-------------|---------|---------|
| `unifi_protect_boulder_api` | UniFi Boulder | cameras |
| `unifi_protect_bulverde_api` | UniFi Bulverde | cameras |
| `abode_credentials` | Abode Security | security |
| `homeassistant_password` | Home Assistant | automation |

---

## Loading Secrets in Code

```javascript
// Using Supabase vault
const { data } = await supabase
  .from('secrets')
  .select('value')
  .eq('name', 'claude_api_key')
  .single();

// Using CF MCP get_secret tool
const secret = await mcp.call('get_secret', { name: 'claude_api_key' });
```

---

*Last Updated: December 2025*
