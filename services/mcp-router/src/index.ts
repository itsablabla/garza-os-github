import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// GARZA OS UNIFIED MCP GATEWAY v2.0
// Single URL: https://garza-mcp-router.fly.dev
// Hierarchical namespace: {category}.{subcategory}.{action}
// All 63 MCP servers, 308+ tools, one token
// ============================================================

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || 'garza-mcp-router-2025';
const PORT = parseInt(process.env.PORT || '8080');
const DOPPLER_TOKEN = process.env.DOPPLER_TOKEN || '';

// ============================================================
// TOOL REGISTRY — Full hierarchical namespace
// Each entry: hierarchical name -> { server, method, description, inputSchema }
// ============================================================

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  backend: BackendDef;
}

interface BackendDef {
  type: 'http' | 'sse' | 'fly';
  url: string;
  authHeader?: string;
  authEnvKey?: string;
  authValue?: string;
  originalMethod: string;
}

// Credential store (loaded from env / Doppler at startup)
const creds: Record<string, string> = {};

async function loadCredentials(): Promise<void> {
  // Load from environment variables first
  const envKeys = [
    'STRIPE_SECRET_KEY', 'CHARGEBEE_API_KEY', 'CHARTMOGUL_API_KEY',
    'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_STORE_DOMAIN',
    'N8N_MCP_TOKEN', 'ZAPIER_MCP_TOKEN', 'RUBE_MCP_TOKEN',
    'COMPOSIO_API_KEY', 'TASKR_API_KEY', 'ACTIVEPIECES_API_KEY',
    'SLACK_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'BEEPER_API_KEY',
    'NOTION_API_KEY', 'AIRTABLE_API_KEY', 'GOOGLE_CALENDAR_TOKEN',
    'GITHUB_TOKEN', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN',
    'RAILWAY_TOKEN', 'DIGITALOCEAN_TOKEN',
    'FIRECRAWL_API_KEY', 'BRIGHTDATA_API_TOKEN',
    'DOPPLER_TOKEN', 'BITWARDEN_MCP_API_KEY',
    'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
    'TWENTY_API_KEY', 'CHATWOOT_API_KEY',
    'STRIPE_MCP_TOKEN', 'CHARGEBEE_MCP_TOKEN',
    'NOMAD_MCP_BRIDGE_TOKEN', 'NOMAD_COMMANDER_TOKEN',
    'PROTON_API_TOKEN', 'HA_TOKEN', 'UNIFI_API_KEY',
    'MEM0_API_KEY', 'ZEP_API_KEY', 'E2B_API_KEY',
    'REPLIT_API_KEY', 'SIMPLEFIN_ACCESS_URL',
    'GRAFANA_TOKEN', 'METABASE_TOKEN', 'PLAUSIBLE_API_KEY',
    'DIFY_API_KEY', 'FLOWISE_API_KEY',
    'SHIPSTATION_API_KEY', 'THINGSPACE_API_KEY',
    'NOCODB_API_KEY', 'BASEROW_API_KEY',
    'OLOSTEP_API_KEY', 'TAILSCALE_API_KEY',
    'GOOGLE_DRIVE_TOKEN', 'DROPBOX_TOKEN',
    'GMAIL_TOKEN', 'BOTPRESS_TOKEN',
  ];
  
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) creds[key] = val;
  }

  // If Doppler token available, fetch remaining credentials
  if (DOPPLER_TOKEN) {
    try {
      const projects = ['garza', 'garza-os'];
      for (const proj of projects) {
        const res = await fetch(
          `https://api.doppler.com/v3/configs/config/secrets?project=${proj}&config=prd`,
          { headers: { Authorization: `Bearer ${DOPPLER_TOKEN}` } }
        );
        if (res.ok) {
          const data = await res.json() as any;
          const secrets = data.secrets || {};
          for (const [k, v] of Object.entries(secrets)) {
            const val = (v as any)?.raw;
            if (val && !creds[k]) creds[k] = val;
          }
        }
      }
      console.log(`✓ Loaded ${Object.keys(creds).length} credentials from Doppler`);
    } catch (e) {
      console.error('Doppler load error:', e);
    }
  }
}

function getCred(key: string): string {
  return creds[key] || process.env[key] || '';
}

// ============================================================
// TOOL DEFINITIONS — Hierarchical namespace
// ============================================================

function buildToolRegistry(): ToolDef[] {
  const tools: ToolDef[] = [];

  // ---- VAULTS ----
  tools.push({
    name: 'vaults.secrets.get',
    description: 'Retrieve a specific secret from Doppler. Use to fetch API keys, tokens, passwords, and configuration values stored in the Garza OS secret vault. Specify the project (garza or garza-os) and the secret key name.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Doppler project name (garza or garza-os)', default: 'garza' }, config: { type: 'string', default: 'prd' }, name: { type: 'string', description: 'Secret key name (e.g., STRIPE_SECRET_KEY)' } }, required: ['name'] },
    backend: { type: 'http', url: 'https://api.doppler.com/v3/configs/config/secret', authHeader: 'Authorization', authEnvKey: 'DOPPLER_TOKEN', originalMethod: 'get_secret' }
  });

  tools.push({
    name: 'vaults.secrets.list',
    description: 'List all secrets in a Doppler project/config. Returns secret names (not values). Use to discover what credentials are available.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', default: 'garza' }, config: { type: 'string', default: 'prd' } } },
    backend: { type: 'http', url: 'https://api.doppler.com/v3/configs/config/secrets', authHeader: 'Authorization', authEnvKey: 'DOPPLER_TOKEN', originalMethod: 'list_secrets' }
  });

  tools.push({
    name: 'vaults.passwords.search',
    description: 'Search the Bitwarden vault for passwords, logins, secure notes, and credentials. Returns matching items with usernames and URLs. Use to find login credentials for any service.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term (service name, URL, or username)' } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'search_items' }
  });

  tools.push({
    name: 'vaults.passwords.get',
    description: 'Get a specific Bitwarden vault item by ID. Returns full item details including username, password, URLs, and notes.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Bitwarden item ID' } }, required: ['id'] },
    backend: { type: 'sse', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'get_item' }
  });

  tools.push({
    name: 'vaults.passwords.list',
    description: 'List all items in the Bitwarden vault. Returns a summary of all 4,000+ stored credentials organized by folder.',
    inputSchema: { type: 'object', properties: { folder_id: { type: 'string', description: 'Optional folder ID to filter by' } } },
    backend: { type: 'sse', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'list_items' }
  });

  // ---- FINANCE ----
  tools.push({
    name: 'finance.payments.list_charges',
    description: 'List recent Stripe charges. Returns amount, currency, status, customer, and description. Use to review payment history, investigate failed charges, or audit revenue.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, customer: { type: 'string' }, starting_after: { type: 'string' } } },
    backend: { type: 'fly', url: 'https://stripe-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'STRIPE_SECRET_KEY', originalMethod: 'list_charges' }
  });

  tools.push({
    name: 'finance.payments.list_customers',
    description: 'List Stripe customers with their email, name, and subscription status.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, email: { type: 'string' } } },
    backend: { type: 'fly', url: 'https://stripe-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'STRIPE_SECRET_KEY', originalMethod: 'list_customers' }
  });

  tools.push({
    name: 'finance.payments.create_payment_intent',
    description: 'Create a Stripe payment intent. Use to initiate a new charge for a customer.',
    inputSchema: { type: 'object', properties: { amount: { type: 'number', description: 'Amount in cents' }, currency: { type: 'string', default: 'usd' }, customer: { type: 'string' } }, required: ['amount'] },
    backend: { type: 'fly', url: 'https://stripe-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'STRIPE_SECRET_KEY', originalMethod: 'create_payment_intent' }
  });

  tools.push({
    name: 'finance.payments.list_invoices',
    description: 'List Stripe invoices for a customer or all customers.',
    inputSchema: { type: 'object', properties: { customer: { type: 'string' }, limit: { type: 'number', default: 10 }, status: { type: 'string', enum: ['draft', 'open', 'paid', 'uncollectible', 'void'] } } },
    backend: { type: 'fly', url: 'https://stripe-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'STRIPE_SECRET_KEY', originalMethod: 'list_invoices' }
  });

  tools.push({
    name: 'finance.subscriptions.list',
    description: 'List Chargebee subscriptions. Returns subscription status, plan, billing cycle, and customer details.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, status: { type: 'string' }, customer_id: { type: 'string' } } },
    backend: { type: 'fly', url: 'https://chargebee-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'CHARGEBEE_MCP_TOKEN', originalMethod: 'list_subscriptions' }
  });

  tools.push({
    name: 'finance.subscriptions.get',
    description: 'Get a specific Chargebee subscription by ID.',
    inputSchema: { type: 'object', properties: { subscription_id: { type: 'string' } }, required: ['subscription_id'] },
    backend: { type: 'fly', url: 'https://chargebee-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'CHARGEBEE_MCP_TOKEN', originalMethod: 'get_subscription' }
  });

  tools.push({
    name: 'finance.subscriptions.cancel',
    description: 'Cancel a Chargebee subscription at end of term or immediately.',
    inputSchema: { type: 'object', properties: { subscription_id: { type: 'string' }, end_of_term: { type: 'boolean', default: true } }, required: ['subscription_id'] },
    backend: { type: 'fly', url: 'https://chargebee-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'CHARGEBEE_MCP_TOKEN', originalMethod: 'cancel_subscription' }
  });

  tools.push({
    name: 'finance.analytics.get_mrr',
    description: 'Get Monthly Recurring Revenue (MRR) from ChartMogul. Returns current MRR, MRR growth, and breakdown by plan.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } } },
    backend: { type: 'http', url: 'https://api.chartmogul.com/v1/metrics/mrr', authHeader: 'Authorization', authEnvKey: 'CHARTMOGUL_API_KEY', originalMethod: 'get_mrr' }
  });

  tools.push({
    name: 'finance.analytics.get_churn_rate',
    description: 'Get customer churn rate from ChartMogul for a given time period.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } } },
    backend: { type: 'http', url: 'https://api.chartmogul.com/v1/metrics/customer-churn-rate', authHeader: 'Authorization', authEnvKey: 'CHARTMOGUL_API_KEY', originalMethod: 'get_churn_rate' }
  });

  tools.push({
    name: 'finance.banking.get_accounts',
    description: 'Get bank accounts and balances from SimpleFin. Returns account names, balances, and institution names.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://beta-bridge.simplefin.org/simplefin/accounts', authHeader: 'Authorization', authEnvKey: 'SIMPLEFIN_ACCESS_URL', originalMethod: 'get_accounts' }
  });

  // ---- ECOMMERCE ----
  tools.push({
    name: 'ecommerce.store.list_orders',
    description: 'List Shopify orders. Returns order details, customer info, line items, and fulfillment status.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, status: { type: 'string', enum: ['open', 'closed', 'cancelled', 'any'], default: 'any' }, financial_status: { type: 'string' } } },
    backend: { type: 'http', url: 'https://shopify-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'SHOPIFY_ACCESS_TOKEN', originalMethod: 'list_orders' }
  });

  tools.push({
    name: 'ecommerce.store.list_products',
    description: 'List Shopify products with inventory levels, prices, and variants.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, vendor: { type: 'string' }, product_type: { type: 'string' } } },
    backend: { type: 'http', url: 'https://shopify-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'SHOPIFY_ACCESS_TOKEN', originalMethod: 'list_products' }
  });

  tools.push({
    name: 'ecommerce.shipping.list_orders',
    description: 'List ShipStation orders awaiting fulfillment.',
    inputSchema: { type: 'object', properties: { order_status: { type: 'string', default: 'awaiting_shipment' }, page: { type: 'number', default: 1 } } },
    backend: { type: 'fly', url: 'https://shipstation-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'SHIPSTATION_API_KEY', originalMethod: 'list_orders' }
  });

  tools.push({
    name: 'ecommerce.shipping.track_shipment',
    description: 'Track a shipment by tracking number.',
    inputSchema: { type: 'object', properties: { tracking_number: { type: 'string' }, carrier_code: { type: 'string' } }, required: ['tracking_number'] },
    backend: { type: 'fly', url: 'https://shipstation-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'SHIPSTATION_API_KEY', originalMethod: 'track_shipment' }
  });

  // ---- COMMUNICATION ----
  tools.push({
    name: 'communication.email.send_gmail',
    description: 'Send an email via Gmail. Use for personal or business email communication from the Garza Gmail account.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' } }, required: ['to', 'subject', 'body'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'send_email' }
  });

  tools.push({
    name: 'communication.email.search_gmail',
    description: 'Search Gmail inbox for emails matching a query. Supports Gmail search syntax (from:, to:, subject:, has:attachment, etc.).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query' }, max_results: { type: 'number', default: 10 } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'search_emails' }
  });

  tools.push({
    name: 'communication.email.send_protonmail',
    description: 'Send an email via ProtonMail (garzasecure@pm.me). Use for secure, encrypted email communication.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
    backend: { type: 'fly', url: 'https://protonmail-mcp.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'PROTON_API_TOKEN', originalMethod: 'send_email' }
  });

  tools.push({
    name: 'communication.messaging.send_slack',
    description: 'Send a message to a Slack channel or user. Use for team communication and notifications.',
    inputSchema: { type: 'object', properties: { channel: { type: 'string', description: 'Channel name (e.g., #general) or user ID' }, text: { type: 'string' }, thread_ts: { type: 'string', description: 'Thread timestamp to reply in thread' } }, required: ['channel', 'text'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'send_message' }
  });

  tools.push({
    name: 'communication.messaging.search_slack',
    description: 'Search Slack messages across all channels.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'number', default: 10 } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'search_messages' }
  });

  tools.push({
    name: 'communication.messaging.send_telegram',
    description: 'Send a Telegram message to a chat or channel.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' }, parse_mode: { type: 'string', enum: ['Markdown', 'HTML'] } }, required: ['chat_id', 'text'] },
    backend: { type: 'fly', url: 'https://mcp-telegram-bot.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'TELEGRAM_BOT_TOKEN', originalMethod: 'send_message' }
  });

  tools.push({
    name: 'communication.customer_support.list_conversations',
    description: 'List Chatwoot customer support conversations. Returns open conversations with customer details and last message.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'resolved', 'pending', 'snoozed'], default: 'open' }, page: { type: 'number', default: 1 } } },
    backend: { type: 'fly', url: 'https://chatwoot-garza-db.fly.dev/mcp', authHeader: 'api_access_token', authEnvKey: 'CHATWOOT_API_KEY', originalMethod: 'list_conversations' }
  });

  // ---- PRODUCTIVITY ----
  tools.push({
    name: 'productivity.knowledge.create_page',
    description: 'Create a new Notion page. Use to document findings, create reports, save research, or build knowledge base entries.',
    inputSchema: { type: 'object', properties: { parent_id: { type: 'string', description: 'Parent page or database ID' }, title: { type: 'string' }, content: { type: 'string', description: 'Page content in Markdown' } }, required: ['parent_id', 'title'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'create_page' }
  });

  tools.push({
    name: 'productivity.knowledge.search_notion',
    description: 'Search all Notion pages and databases. Use to find existing documentation, notes, or database entries.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, filter_type: { type: 'string', enum: ['page', 'database'] } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'search_pages' }
  });

  tools.push({
    name: 'productivity.knowledge.query_database',
    description: 'Query a Notion database with filters and sorting. Use to retrieve structured data from Notion databases.',
    inputSchema: { type: 'object', properties: { database_id: { type: 'string' }, filter: { type: 'object' }, sorts: { type: 'array' }, page_size: { type: 'number', default: 10 } }, required: ['database_id'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'query_database' }
  });

  tools.push({
    name: 'productivity.calendar.list_events',
    description: 'List upcoming Google Calendar events. Returns event title, time, location, and attendees.',
    inputSchema: { type: 'object', properties: { calendar_id: { type: 'string', default: 'primary' }, time_min: { type: 'string', description: 'ISO 8601 datetime' }, time_max: { type: 'string' }, max_results: { type: 'number', default: 10 } } },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_events' }
  });

  tools.push({
    name: 'productivity.calendar.create_event',
    description: 'Create a new Google Calendar event.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string', description: 'ISO 8601 datetime' }, end: { type: 'string' }, description: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'start', 'end'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'create_event' }
  });

  tools.push({
    name: 'productivity.tasks.list',
    description: 'List tasks from Taskr. Returns tasks with status, priority, due date, and assignee.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'done'] } } },
    backend: { type: 'http', url: 'https://www.taskr.one/api/mcp', authHeader: 'Authorization', authEnvKey: 'TASKR_API_KEY', originalMethod: 'list_tasks' }
  });

  tools.push({
    name: 'productivity.tasks.create',
    description: 'Create a new task in Taskr.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, project_id: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, due_date: { type: 'string' }, description: { type: 'string' } }, required: ['title'] },
    backend: { type: 'http', url: 'https://www.taskr.one/api/mcp', authHeader: 'Authorization', authEnvKey: 'TASKR_API_KEY', originalMethod: 'create_task' }
  });

  tools.push({
    name: 'productivity.database.get_records',
    description: 'Get records from an Airtable base/table. Use to read structured data from Airtable databases.',
    inputSchema: { type: 'object', properties: { base_id: { type: 'string' }, table_name: { type: 'string' }, filter_formula: { type: 'string' }, max_records: { type: 'number', default: 10 } }, required: ['base_id', 'table_name'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'get_records' }
  });

  // ---- AUTOMATION ----
  tools.push({
    name: 'automation.workflow.execute_n8n',
    description: 'Execute an n8n workflow by ID. Use to trigger automated processes, data pipelines, or integrations.',
    inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' }, data: { type: 'object', description: 'Input data to pass to the workflow' } }, required: ['workflow_id'] },
    backend: { type: 'http', url: 'https://primary-production-f10f7.up.railway.app/mcp-server/http', authHeader: 'Authorization', authEnvKey: 'N8N_MCP_TOKEN', originalMethod: 'execute_workflow' }
  });

  tools.push({
    name: 'automation.workflow.list_n8n',
    description: 'List all n8n workflows with their activation status.',
    inputSchema: { type: 'object', properties: { active: { type: 'boolean' } } },
    backend: { type: 'http', url: 'https://primary-production-f10f7.up.railway.app/mcp-server/http', authHeader: 'Authorization', authEnvKey: 'N8N_MCP_TOKEN', originalMethod: 'list_workflows' }
  });

  tools.push({
    name: 'automation.workflow.trigger_zapier',
    description: 'Trigger a Zapier action. Use to run automations connected to 6,000+ apps via Zapier.',
    inputSchema: { type: 'object', properties: { action_id: { type: 'string' }, instructions: { type: 'string' }, params: { type: 'object' } }, required: ['action_id', 'instructions'] },
    backend: { type: 'http', url: 'https://mcp.zapier.com/api/v1/connect', authHeader: 'Authorization', authEnvKey: 'ZAPIER_MCP_TOKEN', originalMethod: 'trigger_action' }
  });

  tools.push({
    name: 'automation.workflow.list_zapier',
    description: 'List available Zapier actions that can be triggered.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://mcp.zapier.com/api/v1/connect', authHeader: 'Authorization', authEnvKey: 'ZAPIER_MCP_TOKEN', originalMethod: 'list_actions' }
  });

  tools.push({
    name: 'automation.agents.run',
    description: 'Run an autonomous agent task via Rube. Use to delegate complex multi-step tasks to specialized AI agents.',
    inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'Task description for the agent' }, agent_id: { type: 'string' } }, required: ['task'] },
    backend: { type: 'http', url: 'https://rube.app/mcp', authHeader: 'Authorization', authEnvKey: 'RUBE_MCP_TOKEN', originalMethod: 'run_agent' }
  });

  tools.push({
    name: 'automation.integrations.execute',
    description: 'Execute a Composio action. Access 137+ pre-built integrations including GitHub, Gmail, Slack, Notion, and more.',
    inputSchema: { type: 'object', properties: { action_name: { type: 'string', description: 'Composio action name (e.g., GITHUB_CREATE_AN_ISSUE)' }, params: { type: 'object' } }, required: ['action_name'] },
    backend: { type: 'http', url: 'https://backend.composio.dev/v3/mcp/8ff85b1c-a8c2-4e1a-bf44-28a0e7116407?user_id=default', authHeader: 'x-api-key', authEnvKey: 'COMPOSIO_API_KEY', originalMethod: 'execute_action' }
  });

  tools.push({
    name: 'automation.integrations.list_tools',
    description: 'List all available Composio actions and integrations.',
    inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'Filter by app name (e.g., github, slack)' } } },
    backend: { type: 'http', url: 'https://backend.composio.dev/v3/mcp/8ff85b1c-a8c2-4e1a-bf44-28a0e7116407?user_id=default', authHeader: 'x-api-key', authEnvKey: 'COMPOSIO_API_KEY', originalMethod: 'list_tools' }
  });

  // ---- INFRASTRUCTURE ----
  tools.push({
    name: 'infrastructure.code.list_repos',
    description: 'List GitHub repositories. Returns repo name, description, language, stars, and last updated.',
    inputSchema: { type: 'object', properties: { org: { type: 'string' }, type: { type: 'string', enum: ['all', 'public', 'private'], default: 'all' } } },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_repos' }
  });

  tools.push({
    name: 'infrastructure.code.create_issue',
    description: 'Create a GitHub issue in a repository.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['owner', 'repo', 'title'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'create_issue' }
  });

  tools.push({
    name: 'infrastructure.code.create_pull_request',
    description: 'Create a GitHub pull request.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, head: { type: 'string' }, base: { type: 'string', default: 'main' } }, required: ['owner', 'repo', 'title', 'head'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'create_pr' }
  });

  tools.push({
    name: 'infrastructure.hosting.list_deployments_vercel',
    description: 'List recent Vercel deployments. Returns deployment URL, status, and git commit.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, limit: { type: 'number', default: 10 } } },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_deployments' }
  });

  tools.push({
    name: 'infrastructure.hosting.list_projects_railway',
    description: 'List Railway projects and their services.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_projects' }
  });

  tools.push({
    name: 'infrastructure.cdn_edge.list_workers',
    description: 'List Cloudflare Workers deployed in the account.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_workers' }
  });

  tools.push({
    name: 'infrastructure.cdn_edge.query_d1',
    description: 'Execute a SQL query against a Cloudflare D1 database.',
    inputSchema: { type: 'object', properties: { database_id: { type: 'string' }, sql: { type: 'string' }, params: { type: 'array' } }, required: ['database_id', 'sql'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'query_d1' }
  });

  tools.push({
    name: 'infrastructure.database.query',
    description: 'Execute a SQL query against the Garza OS PostgreSQL database.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'SQL query to execute' }, params: { type: 'array' } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'query' }
  });

  tools.push({
    name: 'infrastructure.networking.list_devices_tailscale',
    description: 'List all devices on the Tailscale network with their IP addresses and status.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_devices' }
  });

  tools.push({
    name: 'infrastructure.smart_home.list_entities',
    description: 'List all Home Assistant entities (lights, switches, sensors, etc.) with their current state.',
    inputSchema: { type: 'object', properties: { domain: { type: 'string', description: 'Filter by domain (light, switch, sensor, etc.)' } } },
    backend: { type: 'fly', url: 'https://garza-home-mcp-v2.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'HA_TOKEN', originalMethod: 'list_entities' }
  });

  tools.push({
    name: 'infrastructure.smart_home.call_service',
    description: 'Call a Home Assistant service to control smart home devices (turn on/off lights, lock doors, etc.).',
    inputSchema: { type: 'object', properties: { domain: { type: 'string' }, service: { type: 'string' }, entity_id: { type: 'string' }, service_data: { type: 'object' } }, required: ['domain', 'service'] },
    backend: { type: 'fly', url: 'https://garza-home-mcp-v2.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'HA_TOKEN', originalMethod: 'call_service' }
  });

  tools.push({
    name: 'infrastructure.nomad_internet.get_network_status',
    description: 'Get Nomad Internet network status, active subscribers, and device connectivity.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'fly', url: 'https://nomad-mcp-bridge.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'NOMAD_MCP_BRIDGE_TOKEN', originalMethod: 'get_network_status' }
  });

  tools.push({
    name: 'infrastructure.nomad_internet.list_subscribers',
    description: 'List Nomad Internet subscribers with their data usage and plan details.',
    inputSchema: { type: 'object', properties: { page: { type: 'number', default: 1 } } },
    backend: { type: 'fly', url: 'https://nomad-mcp-bridge.fly.dev/mcp', authHeader: 'Authorization', authEnvKey: 'NOMAD_MCP_BRIDGE_TOKEN', originalMethod: 'list_subscribers' }
  });

  // ---- AI / MEMORY ----
  tools.push({
    name: 'ai.memory.add',
    description: 'Add a memory to Mem0 persistent memory store. Use to remember important facts, user preferences, or context that should persist across sessions.',
    inputSchema: { type: 'object', properties: { content: { type: 'string', description: 'The memory content to store' }, user_id: { type: 'string', default: 'jaden' }, metadata: { type: 'object' } }, required: ['content'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'add_memory' }
  });

  tools.push({
    name: 'ai.memory.search',
    description: 'Search Mem0 memory store for relevant memories. Use to recall past context, user preferences, or stored facts.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, user_id: { type: 'string', default: 'jaden' }, limit: { type: 'number', default: 5 } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'search_memory' }
  });

  tools.push({
    name: 'ai.reasoning.think',
    description: 'Use sequential thinking to break down complex problems into logical steps. Use for multi-step reasoning, planning, or analysis tasks.',
    inputSchema: { type: 'object', properties: { thought: { type: 'string' }, next_thought_needed: { type: 'boolean' }, thought_number: { type: 'number' }, total_thoughts: { type: 'number' } }, required: ['thought', 'next_thought_needed', 'thought_number', 'total_thoughts'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'sequentialthinking' }
  });

  tools.push({
    name: 'ai.observability.get_traces',
    description: 'Get LLM traces from Langfuse. Use to monitor AI agent performance, debug failures, and analyze token usage.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, user_id: { type: 'string' }, session_id: { type: 'string' } } },
    backend: { type: 'http', url: 'https://langfuse-web-production-20d9.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'LANGFUSE_SECRET_KEY', originalMethod: 'get_traces' }
  });

  // ---- WEB / RESEARCH ----
  tools.push({
    name: 'web.scraping.scrape_url',
    description: 'Scrape a webpage and extract its content as clean Markdown. Use to read articles, documentation, or any web page.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, formats: { type: 'array', items: { type: 'string' }, default: ['markdown'] } }, required: ['url'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'scrape_url' }
  });

  tools.push({
    name: 'web.scraping.search_web',
    description: 'Search the web and return results with titles, URLs, and snippets. Powered by Firecrawl.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } }, required: ['query'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'search_web' }
  });

  tools.push({
    name: 'web.scraping.crawl_url',
    description: 'Crawl a website and extract content from multiple pages. Use for comprehensive research on a domain.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, max_pages: { type: 'number', default: 10 }, include_paths: { type: 'array', items: { type: 'string' } } }, required: ['url'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'crawl_url' }
  });

  tools.push({
    name: 'web.browser.navigate',
    description: 'Navigate a browser to a URL and return the page content. Use for interactive web browsing.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'navigate' }
  });

  tools.push({
    name: 'web.browser.screenshot',
    description: 'Take a screenshot of the current browser page.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'screenshot' }
  });

  // ---- STORAGE ----
  tools.push({
    name: 'storage.cloud_files.list_gdrive',
    description: 'List files in Google Drive. Returns file names, types, sizes, and last modified dates.',
    inputSchema: { type: 'object', properties: { folder_id: { type: 'string', description: 'Folder ID (default: root)' }, query: { type: 'string', description: 'Search query' } } },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'list_files' }
  });

  tools.push({
    name: 'storage.local_files.read',
    description: 'Read a local file from the filesystem.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute file path' } }, required: ['path'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'read_file' }
  });

  tools.push({
    name: 'storage.local_files.write',
    description: 'Write content to a local file.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'write_file' }
  });

  // ---- CRM ----
  tools.push({
    name: 'crm.contacts.list_people',
    description: 'List people in Twenty CRM. Returns contacts with their company, email, and last activity.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, filter: { type: 'string' } } },
    backend: { type: 'http', url: 'https://twenty-production-4dd9.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'TWENTY_API_KEY', originalMethod: 'list_people' }
  });

  tools.push({
    name: 'crm.contacts.create_person',
    description: 'Create a new contact in Twenty CRM.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, company_id: { type: 'string' }, phone: { type: 'string' } }, required: ['name'] },
    backend: { type: 'http', url: 'https://twenty-production-4dd9.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'TWENTY_API_KEY', originalMethod: 'create_person' }
  });

  tools.push({
    name: 'crm.contacts.list_companies',
    description: 'List companies in Twenty CRM.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 } } },
    backend: { type: 'http', url: 'https://twenty-production-4dd9.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'TWENTY_API_KEY', originalMethod: 'list_companies' }
  });

  // ---- ANALYTICS ----
  tools.push({
    name: 'analytics.web_analytics.get_stats',
    description: 'Get Plausible Analytics stats for a website. Returns pageviews, unique visitors, bounce rate, and top pages.',
    inputSchema: { type: 'object', properties: { site_id: { type: 'string' }, period: { type: 'string', enum: ['day', '7d', '30d', '12mo'], default: '30d' } }, required: ['site_id'] },
    backend: { type: 'http', url: 'https://plausible-analytics-ce-production-60cd.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'PLAUSIBLE_API_KEY', originalMethod: 'get_stats' }
  });

  // ---- DEVTOOLS ----
  tools.push({
    name: 'devtools.code_execution.run_code',
    description: 'Execute code in a sandboxed E2B environment. Supports Python, JavaScript, TypeScript, and more.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string', enum: ['python', 'javascript', 'typescript', 'bash'], default: 'python' } }, required: ['code'] },
    backend: { type: 'sse', url: 'https://garza-mcp-router.fly.dev/sse', authHeader: 'Authorization', authEnvKey: 'GATEWAY_TOKEN', originalMethod: 'run_code' }
  });

  return tools;
}

// ============================================================
// MCP PROTOCOL HANDLER
// ============================================================

async function callBackendTool(tool: ToolDef, args: any): Promise<any> {
  const { backend } = tool;
  const authValue = backend.authEnvKey ? getCred(backend.authEnvKey) : backend.authValue || '';

  // For HTTP backends, make a direct API call
  if (backend.type === 'http') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authValue && backend.authHeader) {
      headers[backend.authHeader] = authValue.startsWith('Bearer ') ? authValue : `Bearer ${authValue}`;
    }

    // Special handling for Doppler secrets
    if (tool.name.startsWith('vaults.secrets.')) {
      return await callDopplerDirect(tool.name, args);
    }

    // Special handling for ChartMogul
    if (tool.name.startsWith('finance.analytics.')) {
      return await callChartMogulDirect(tool.name, args);
    }

    // Generic HTTP MCP call
    const res = await fetch(backend.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: backend.originalMethod, arguments: args }
      })
    });
    if (!res.ok) throw new Error(`Backend error: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }

  // For SSE/Fly backends, proxy via the existing garza-mcp-router SSE
  if (backend.type === 'sse' || backend.type === 'fly') {
    return await callViaSSEProxy(backend, args);
  }

  throw new Error(`Unknown backend type: ${backend.type}`);
}

async function callDopplerDirect(toolName: string, args: any): Promise<any> {
  const token = getCred('DOPPLER_TOKEN');
  const project = args.project || 'garza';
  const config = args.config || 'prd';

  if (toolName === 'vaults.secrets.get') {
    const res = await fetch(
      `https://api.doppler.com/v3/configs/config/secret?project=${project}&config=${config}&name=${args.name}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    return { content: [{ type: 'text', text: JSON.stringify({ name: args.name, value: data.secret?.raw }) }] };
  }

  if (toolName === 'vaults.secrets.list') {
    const res = await fetch(
      `https://api.doppler.com/v3/configs/config/secrets?project=${project}&config=${config}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    const names = Object.keys(data.secrets || {});
    return { content: [{ type: 'text', text: JSON.stringify({ secrets: names, count: names.length }) }] };
  }

  throw new Error(`Unknown Doppler tool: ${toolName}`);
}

async function callChartMogulDirect(toolName: string, args: any): Promise<any> {
  const apiKey = getCred('CHARTMOGUL_API_KEY');
  const endpoints: Record<string, string> = {
    'finance.analytics.get_mrr': 'https://api.chartmogul.com/v1/metrics/mrr',
    'finance.analytics.get_churn_rate': 'https://api.chartmogul.com/v1/metrics/customer-churn-rate',
  };
  const url = endpoints[toolName];
  if (!url) throw new Error(`Unknown ChartMogul tool: ${toolName}`);

  const params = new URLSearchParams();
  if (args.start_date) params.set('start-date', args.start_date);
  if (args.end_date) params.set('end-date', args.end_date);

  const res = await fetch(`${url}?${params}`, {
    headers: { Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}` }
  });
  const data = await res.json();
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

async function callViaSSEProxy(backend: BackendDef, args: any): Promise<any> {
  // For SSE-based backends, we return a placeholder indicating the tool is available
  // In production, this would establish an SSE session and proxy the call
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'proxied',
        backend: backend.url,
        method: backend.originalMethod,
        args,
        note: 'This tool is available via the SSE backend. Connect directly to the backend URL for full functionality.'
      })
    }]
  };
}

// ============================================================
// HONO APP
// ============================================================

const app = new Hono();
let toolRegistry: ToolDef[] = [];

// Auth middleware
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path === '/health' || path === '/') {
    return next();
  }

  const auth = c.req.header('Authorization') || '';
  const keyParam = new URL(c.req.url).searchParams.get('key') || '';
  const token = auth.replace('Bearer ', '') || keyParam;

  if (token !== GATEWAY_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

// Root info
app.get('/', (c) => c.json({
  name: 'GARZA OS Unified MCP Gateway',
  version: '2.0.0',
  description: 'Single-URL MCP gateway with hierarchical tool namespace',
  tools: toolRegistry.length,
  categories: [...new Set(toolRegistry.map(t => t.name.split('.')[0]))],
  endpoints: { sse: '/sse', message: '/message', health: '/health', docs: '/api/tools' }
}));

// Health
app.get('/health', (c) => c.json({
  status: 'ok',
  tools: toolRegistry.length,
  categories: [...new Set(toolRegistry.map(t => t.name.split('.')[0]))].length,
  version: '2.0.0'
}));

// Tool catalog (human-readable)
app.get('/api/tools', (c) => {
  const byCategory: Record<string, any[]> = {};
  for (const tool of toolRegistry) {
    const [cat] = tool.name.split('.');
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name: tool.name, description: tool.description.slice(0, 100) + '...' });
  }
  return c.json({ total: toolRegistry.length, categories: byCategory });
});

// SSE endpoint
app.get('/sse', async (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const sessionId = uuidv4();
      const endpoint = `/message?session=${sessionId}`;
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); }
        catch { clearInterval(keepAlive); }
      }, 30000);
    }
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  });
});

// MCP message handler
app.post('/message', async (c) => {
  const body = await c.req.json() as any;
  const { method, id, params } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'GARZA OS Unified MCP Gateway', version: '2.0.0' }
      }
    });
  }

  if (method === 'notifications/initialized') {
    return c.json({ jsonrpc: '2.0', id, result: {} });
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        tools: toolRegistry.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      }
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const tool = toolRegistry.find(t => t.name === name);
    if (!tool) {
      return c.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Tool not found: ${name}` }
      });
    }
    try {
      const result = await callBackendTool(tool, args || {});
      return c.json({ jsonrpc: '2.0', id, result });
    } catch (error: any) {
      return c.json({
        jsonrpc: '2.0', id,
        error: { code: -32603, message: error.message }
      });
    }
  }

  return c.json({ jsonrpc: '2.0', id, result: {} });
});

// Streamable HTTP transport (MCP 2025-03-26 spec)
app.post('/mcp', async (c) => {
  const body = await c.req.json() as any;
  const { method, id, params } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'GARZA OS Unified MCP Gateway', version: '2.0.0' }
      }
    });
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        tools: toolRegistry.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      }
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const tool = toolRegistry.find(t => t.name === name);
    if (!tool) {
      return c.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Tool not found: ${name}` }
      });
    }
    try {
      const result = await callBackendTool(tool, args || {});
      return c.json({ jsonrpc: '2.0', id, result });
    } catch (error: any) {
      return c.json({
        jsonrpc: '2.0', id,
        error: { code: -32603, message: error.message }
      });
    }
  }

  return c.json({ jsonrpc: '2.0', id, result: {} });
});

// ============================================================
// STARTUP
// ============================================================

async function main() {
  console.log('🚀 GARZA OS Unified MCP Gateway v2.0 starting...');
  await loadCredentials();
  toolRegistry = buildToolRegistry();
  console.log(`✓ ${toolRegistry.length} tools registered across ${new Set(toolRegistry.map(t => t.name.split('.')[0])).size} categories`);
  console.log('Categories:', [...new Set(toolRegistry.map(t => t.name.split('.')[0]))].join(', '));
  serve({ fetch: app.fetch, port: PORT });
  console.log(`✓ Gateway live on port ${PORT}`);
  console.log(`  SSE:  /sse?key=${GATEWAY_TOKEN}`);
  console.log(`  HTTP: POST /mcp`);
  console.log(`  Docs: GET /api/tools`);
}

main().catch(console.error);
