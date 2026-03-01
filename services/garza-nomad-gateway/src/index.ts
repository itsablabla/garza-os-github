import { Hono } from 'hono';
import { serve } from '@hono/node-server';
// ============================================================
// GARZA OS NOMAD MCP GATEWAY v1.0
// Stack: nomad (business operations / nomad internet)
// Categories: vaults, finance, ecommerce, crm, automation, communication, analytics
// URL: https://garza-nomad-gateway-production.up.railway.app
// ============================================================
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || 'garza-nomad-2025';
const PORT = parseInt(process.env.PORT || '8080');
const DOPPLER_TOKEN = process.env.DOPPLER_TOKEN || '';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  backend: BackendDef;
}
interface BackendDef {
  type: 'http' | 'npx' | 'direct';
  url?: string;
  authHeader?: string;
  authEnvKey?: string;
  authValue?: string;
  originalMethod: string;
}

const creds: Record<string, string> = {};

async function loadCredentials(): Promise<void> {
  const envKeys = [
    'DOPPLER_TOKEN', 'BITWARDEN_MCP_API_KEY',
    'STRIPE_SECRET_KEY', 'CHARGEBEE_API_KEY', 'CHARTMOGUL_API_KEY',
    'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_STORE_DOMAIN',
    'SHIPSTATION_API_KEY', 'SIMPLEFIN_ACCESS_URL',
    'TWENTY_API_KEY', 'CHATWOOT_API_KEY',
    'BOTPRESS_TOKEN', 'JADA_CHAT_TOKEN',
    'PLAUSIBLE_API_KEY', 'METABASE_TOKEN',
    'N8N_MCP_TOKEN', 'ACTIVEPIECES_API_KEY',
    'ZAPIER_MCP_TOKEN', 'COMPOSIO_API_KEY',
    'RUBE_MCP_TOKEN', 'TASKR_API_KEY',
    'LANGFUSE_SECRET_KEY',
    'NOMAD_MCP_BRIDGE_TOKEN', 'NOMAD_COMMANDER_TOKEN',
    'THINGSPACE_API_KEY',
    'POSTGRES_URL',
  ];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) creds[key] = val;
  }
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

async function callHttpTool(backend: BackendDef, args: any): Promise<any> {
  const url = backend.url!;
  const authVal = backend.authValue || getCred(backend.authEnvKey || '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (backend.authHeader && authVal) {
    headers[backend.authHeader] = authVal.startsWith('Bearer ') ? authVal : `Bearer ${authVal}`;
  }
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'tools/call',
    params: { name: backend.originalMethod, arguments: args }
  });
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (text.includes('data: ')) {
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.result) return parsed.result;
      } catch {}
    }
  }
  try { return JSON.parse(text); } catch { return { content: [{ type: 'text', text }] }; }
}

async function buildTools(): Promise<ToolDef[]> {
  const tools: ToolDef[] = [];

  // ============================================================
  // VAULTS
  // ============================================================
  tools.push({
    name: 'vaults.secrets.get',
    description: 'Retrieve a specific secret from Doppler. Use to fetch API keys and credentials for Nomad Internet services.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', default: 'garza' }, config: { type: 'string', default: 'prd' }, name: { type: 'string' } }, required: ['name'] },
    backend: { type: 'direct', originalMethod: 'get_secret' }
  });
  tools.push({
    name: 'vaults.secrets.list',
    description: 'List all secret names in a Doppler project.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', default: 'garza' }, config: { type: 'string', default: 'prd' } } },
    backend: { type: 'direct', originalMethod: 'list_secrets' }
  });
  tools.push({
    name: 'vaults.passwords.search',
    description: 'Search Bitwarden vault for credentials by name or URL.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    backend: { type: 'http', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'search_vault' }
  });

  // ============================================================
  // FINANCE — Stripe, Chargebee, ChartMogul, SimpleFin
  // ============================================================
  tools.push({
    name: 'finance.payments.list_charges',
    description: 'List recent Stripe charges. Use to audit revenue, investigate failed payments, or review transaction history.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, customer: { type: 'string' }, created_after: { type: 'number', description: 'Unix timestamp' } } },
    backend: { type: 'npx', originalMethod: 'list_charges' }
  });
  tools.push({
    name: 'finance.payments.get_customer',
    description: 'Get a Stripe customer by ID or email. Returns subscription status, payment methods, and billing details.',
    inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, email: { type: 'string' } } },
    backend: { type: 'npx', originalMethod: 'retrieve_customer' }
  });
  tools.push({
    name: 'finance.payments.create_refund',
    description: 'Create a Stripe refund for a charge.',
    inputSchema: { type: 'object', properties: { charge_id: { type: 'string' }, amount: { type: 'number', description: 'Amount in cents' }, reason: { type: 'string', enum: ['duplicate', 'fraudulent', 'requested_by_customer'] } }, required: ['charge_id'] },
    backend: { type: 'npx', originalMethod: 'create_refund' }
  });
  tools.push({
    name: 'finance.subscriptions.list',
    description: 'List Chargebee subscriptions. Use to review subscriber status, plan details, and renewal dates.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'cancelled', 'in_trial', 'past_due'] }, limit: { type: 'number', default: 25 } } },
    backend: { type: 'http', url: 'https://app.chargebee.com/api/v2/mcp', authHeader: 'Authorization', authEnvKey: 'CHARGEBEE_API_KEY', originalMethod: 'list_subscriptions' }
  });
  tools.push({
    name: 'finance.subscriptions.cancel',
    description: 'Cancel a Chargebee subscription.',
    inputSchema: { type: 'object', properties: { subscription_id: { type: 'string' }, end_of_term: { type: 'boolean', default: true } }, required: ['subscription_id'] },
    backend: { type: 'http', url: 'https://app.chargebee.com/api/v2/mcp', authHeader: 'Authorization', authEnvKey: 'CHARGEBEE_API_KEY', originalMethod: 'cancel_subscription' }
  });
  tools.push({
    name: 'finance.analytics.get_mrr',
    description: 'Get Monthly Recurring Revenue (MRR) metrics from ChartMogul. Use for revenue reporting and growth tracking.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string', description: 'YYYY-MM-DD' }, end_date: { type: 'string', description: 'YYYY-MM-DD' } } },
    backend: { type: 'http', url: 'https://api.chartmogul.com/v1/mcp', authHeader: 'Authorization', authEnvKey: 'CHARTMOGUL_API_KEY', originalMethod: 'get_mrr' }
  });
  tools.push({
    name: 'finance.analytics.get_churn',
    description: 'Get churn rate metrics from ChartMogul.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } } },
    backend: { type: 'http', url: 'https://api.chartmogul.com/v1/mcp', authHeader: 'Authorization', authEnvKey: 'CHARTMOGUL_API_KEY', originalMethod: 'get_churn_rate' }
  });
  tools.push({
    name: 'finance.banking.get_accounts',
    description: 'Get bank account balances and transactions via SimpleFin.',
    inputSchema: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } } },
    backend: { type: 'http', url: getCred('SIMPLEFIN_ACCESS_URL') || 'https://beta-bridge.simplefin.org/simplefin/mcp', authHeader: 'Authorization', authEnvKey: 'SIMPLEFIN_ACCESS_URL', originalMethod: 'get_accounts' }
  });

  // ============================================================
  // ECOMMERCE — Shopify, ShipStation
  // ============================================================
  tools.push({
    name: 'ecommerce.store.list_orders',
    description: 'List Shopify orders. Use to review recent purchases, check order status, or audit sales.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed', 'cancelled', 'any'], default: 'open' }, limit: { type: 'number', default: 10 } } },
    backend: { type: 'npx', originalMethod: 'get-orders' }
  });
  tools.push({
    name: 'ecommerce.store.get_products',
    description: 'List Shopify products and inventory.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 }, status: { type: 'string', enum: ['active', 'draft', 'archived'] } } },
    backend: { type: 'npx', originalMethod: 'get-products' }
  });
  tools.push({
    name: 'ecommerce.store.get_customers',
    description: 'List or search Shopify customers.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 20 } } },
    backend: { type: 'npx', originalMethod: 'get-customers' }
  });
  tools.push({
    name: 'ecommerce.shipping.list_orders',
    description: 'List ShipStation shipping orders. Use to track fulfillment status and shipping queues.',
    inputSchema: { type: 'object', properties: { order_status: { type: 'string', default: 'awaiting_shipment' }, page: { type: 'number', default: 1 } } },
    backend: { type: 'http', url: 'https://shipstation-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'SHIPSTATION_API_KEY', originalMethod: 'list_orders' }
  });
  tools.push({
    name: 'ecommerce.shipping.track_shipment',
    description: 'Track a shipment by tracking number.',
    inputSchema: { type: 'object', properties: { tracking_number: { type: 'string' }, carrier_code: { type: 'string' } }, required: ['tracking_number'] },
    backend: { type: 'http', url: 'https://shipstation-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'SHIPSTATION_API_KEY', originalMethod: 'track_shipment' }
  });

  // ============================================================
  // CRM — Twenty CRM, Chatwoot
  // ============================================================
  tools.push({
    name: 'crm.contacts.list',
    description: 'List contacts in Twenty CRM.',
    inputSchema: { type: 'object', properties: { filter: { type: 'string' }, limit: { type: 'number', default: 20 } } },
    backend: { type: 'http', url: 'https://twenty-production-4dd9.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'TWENTY_API_KEY', originalMethod: 'list_people' }
  });
  tools.push({
    name: 'crm.contacts.create',
    description: 'Create a new contact in Twenty CRM.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, phone: { type: 'string' } }, required: ['name'] },
    backend: { type: 'http', url: 'https://twenty-production-4dd9.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'TWENTY_API_KEY', originalMethod: 'create_person' }
  });
  tools.push({
    name: 'crm.support.list_conversations',
    description: 'List Chatwoot customer support conversations.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'resolved', 'pending'], default: 'open' }, page: { type: 'number', default: 1 } } },
    backend: { type: 'http', url: 'https://chatwoot-production-2080.up.railway.app/mcp', authHeader: 'api_access_token', authEnvKey: 'CHATWOOT_API_KEY', originalMethod: 'list_conversations' }
  });
  tools.push({
    name: 'crm.support.reply_conversation',
    description: 'Reply to a Chatwoot customer support conversation.',
    inputSchema: { type: 'object', properties: { conversation_id: { type: 'number' }, message: { type: 'string' } }, required: ['conversation_id', 'message'] },
    backend: { type: 'http', url: 'https://chatwoot-production-2080.up.railway.app/mcp', authHeader: 'api_access_token', authEnvKey: 'CHATWOOT_API_KEY', originalMethod: 'send_message' }
  });

  // ============================================================
  // COMMUNICATION — Botpress/Jada AI, Zapier
  // ============================================================
  tools.push({
    name: 'communication.jada.send_message',
    description: 'Send a message to Jada (Nomad Internet AI assistant) via Botpress.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, conversation_id: { type: 'string' } }, required: ['message'] },
    backend: { type: 'http', url: 'https://studio.botpress.cloud/61647ec6-7060-4fcd-822a-028a997f6ddf/api', authHeader: 'Authorization', authEnvKey: 'BOTPRESS_TOKEN', originalMethod: 'send_message' }
  });
  tools.push({
    name: 'communication.zapier.list_zaps',
    description: 'List all Zapier automation Zaps.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://mcp.zapier.com/api/v1/connect', authHeader: 'Authorization', authEnvKey: 'ZAPIER_MCP_TOKEN', originalMethod: 'list_zaps' }
  });

  // ============================================================
  // AUTOMATION — n8n, ActivePieces, Composio, Rube, Taskr
  // ============================================================
  tools.push({
    name: 'automation.n8n.list_workflows',
    description: 'List all n8n automation workflows for Nomad Internet operations.',
    inputSchema: { type: 'object', properties: { active: { type: 'boolean' } } },
    backend: { type: 'http', url: 'https://primary-production-f10f7.up.railway.app/mcp-server/http', authHeader: 'Authorization', authEnvKey: 'N8N_MCP_TOKEN', originalMethod: 'n8n_list_workflows' }
  });
  tools.push({
    name: 'automation.n8n.execute_workflow',
    description: 'Execute an n8n workflow by ID.',
    inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' }, data: { type: 'object' } }, required: ['workflow_id'] },
    backend: { type: 'http', url: 'https://primary-production-f10f7.up.railway.app/mcp-server/http', authHeader: 'Authorization', authEnvKey: 'N8N_MCP_TOKEN', originalMethod: 'n8n_run_workflow' }
  });
  tools.push({
    name: 'automation.activepieces.list_flows',
    description: 'List ActivePieces automation flows.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://automation.garzahive.com/api/v1/mcp', authHeader: 'Authorization', authEnvKey: 'ACTIVEPIECES_API_KEY', originalMethod: 'list_flows' }
  });
  tools.push({
    name: 'automation.composio.run_action',
    description: 'Run a Composio action (supports 250+ app integrations).',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, params: { type: 'object' } }, required: ['action'] },
    backend: { type: 'http', url: 'https://backend.composio.dev/v3/mcp/8ff85b1c-a8c2-4e1a-bf44-28a0e7116407?user_id=default', authHeader: 'x-api-key', authEnvKey: 'COMPOSIO_API_KEY', originalMethod: 'execute_action' }
  });
  tools.push({
    name: 'automation.rube.run',
    description: 'Execute a Rube automation task.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, params: { type: 'object' } }, required: ['task'] },
    backend: { type: 'http', url: 'https://rube.app/mcp', authHeader: 'Authorization', authEnvKey: 'RUBE_MCP_TOKEN', originalMethod: 'run_task' }
  });
  tools.push({
    name: 'automation.taskr.list_tasks',
    description: 'List Taskr project management tasks.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, status: { type: 'string' } } },
    backend: { type: 'http', url: 'https://www.taskr.one/api/mcp', authHeader: 'Authorization', authEnvKey: 'TASKR_API_KEY', originalMethod: 'list_tasks' }
  });

  // ============================================================
  // ANALYTICS — Plausible, Metabase, Langfuse
  // ============================================================
  tools.push({
    name: 'analytics.web.get_stats',
    description: 'Get website analytics from Plausible. Returns pageviews, visitors, bounce rate, and top pages.',
    inputSchema: { type: 'object', properties: { site_id: { type: 'string', description: 'Domain (e.g. nomadinternet.com)' }, period: { type: 'string', default: '30d' } }, required: ['site_id'] },
    backend: { type: 'http', url: 'https://plausible-analytics-ce-production-60cd.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'PLAUSIBLE_API_KEY', originalMethod: 'get_stats' }
  });
  tools.push({
    name: 'analytics.bi.run_query',
    description: 'Run a Metabase business intelligence query or get a saved question.',
    inputSchema: { type: 'object', properties: { question_id: { type: 'number' }, parameters: { type: 'array' } }, required: ['question_id'] },
    backend: { type: 'http', url: 'https://metabase-production-e166.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'METABASE_TOKEN', originalMethod: 'run_question' }
  });
  tools.push({
    name: 'analytics.ai_ops.list_traces',
    description: 'List LLM traces from Langfuse for AI observability.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
    backend: { type: 'http', url: 'https://langfuse-web-production-20d9.up.railway.app/api/public/mcp', authHeader: 'Authorization', authEnvKey: 'LANGFUSE_SECRET_KEY', originalMethod: 'list_traces' }
  });

  // ============================================================
  // NOMAD FIELD OPS — Nomad MCP Bridge, Commander, ThingSpace IoT
  // ============================================================
  tools.push({
    name: 'nomad.field.list_devices',
    description: 'List Nomad Internet field devices via the Nomad MCP Bridge. Returns device status, location, and connectivity.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['online', 'offline', 'all'], default: 'all' } } },
    backend: { type: 'http', url: 'https://nomad-mcp-bridge-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'NOMAD_MCP_BRIDGE_TOKEN', originalMethod: 'list_devices' }
  });
  tools.push({
    name: 'nomad.field.get_device_status',
    description: 'Get the current status and telemetry of a specific Nomad field device.',
    inputSchema: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'] },
    backend: { type: 'http', url: 'https://nomad-mcp-bridge-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'NOMAD_MCP_BRIDGE_TOKEN', originalMethod: 'get_device_status' }
  });
  tools.push({
    name: 'nomad.commander.send_command',
    description: 'Send a command to a Nomad field device via Nomad Commander.',
    inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, command: { type: 'string' }, params: { type: 'object' } }, required: ['device_id', 'command'] },
    backend: { type: 'http', url: 'https://nomad-commander-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'NOMAD_COMMANDER_TOKEN', originalMethod: 'send_command' }
  });
  tools.push({
    name: 'nomad.iot.list_devices',
    description: 'List IoT devices connected via Verizon ThingSpace.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    backend: { type: 'http', url: 'https://thingspace-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'THINGSPACE_API_KEY', originalMethod: 'list_devices' }
  });
  tools.push({
    name: 'nomad.iot.get_device_data',
    description: 'Get data and telemetry from a ThingSpace IoT device.',
    inputSchema: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'] },
    backend: { type: 'http', url: 'https://thingspace-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'THINGSPACE_API_KEY', originalMethod: 'get_device_data' }
  });

  // ============================================================
  // AI — Sequential Thinking, Memory
  // ============================================================
  tools.push({
    name: 'ai.reasoning.think',
    description: 'Sequential thinking for complex business problem decomposition.',
    inputSchema: { type: 'object', properties: { thought: { type: 'string' }, next_thought_needed: { type: 'boolean' }, thought_number: { type: 'number' }, total_thoughts: { type: 'number' } }, required: ['thought', 'next_thought_needed', 'thought_number', 'total_thoughts'] },
    backend: { type: 'npx', originalMethod: 'sequentialthinking' }
  });
  tools.push({
    name: 'ai.browser.navigate',
    description: 'Navigate a browser to a URL for web automation.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'browser_navigate' }
  });
  tools.push({
    name: 'ai.database.query',
    description: 'Execute a SQL query against the Postgres database.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'query' }
  });

  return tools;
}

async function executeTool(tool: ToolDef, args: any): Promise<any> {
  const { backend } = tool;

  if (tool.name === 'vaults.secrets.get') {
    const project = args.project || 'garza';
    const config = args.config || 'prd';
    const name = args.name;
    const token = getCred('DOPPLER_TOKEN');
    const res = await fetch(
      `https://api.doppler.com/v3/configs/config/secret?project=${project}&config=${config}&name=${name}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    return { content: [{ type: 'text', text: JSON.stringify({ name, value: data?.secret?.raw || 'NOT_FOUND' }) }] };
  }

  if (tool.name === 'vaults.secrets.list') {
    const project = args.project || 'garza';
    const config = args.config || 'prd';
    const token = getCred('DOPPLER_TOKEN');
    const res = await fetch(
      `https://api.doppler.com/v3/configs/config/secrets?project=${project}&config=${config}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    const names = Object.keys(data?.secrets || {});
    return { content: [{ type: 'text', text: JSON.stringify({ count: names.length, secrets: names }) }] };
  }

  if (backend.type === 'http') {
    return await callHttpTool(backend, args);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        tool: tool.name,
        method: backend.originalMethod,
        args,
        note: 'This tool requires the local npx package. Configure the individual MCP server in your client for direct access.',
        status: 'proxy_required'
      })
    }]
  };
}

const app = new Hono();

function authMiddleware(c: any, next: any) {
  const auth = c.req.header('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (token !== GATEWAY_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

let toolRegistry: ToolDef[] = [];

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    gateway: 'GARZA OS Nomad MCP Gateway',
    version: '1.0.0',
    stack: 'nomad',
    tools_count: toolRegistry.length,
    categories: [...new Set(toolRegistry.map(t => t.name.split('.')[0]))],
  });
});

app.post('/mcp', authMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const { method, params, id } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'GARZA OS Nomad MCP Gateway', version: '1.0.0' }
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
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const tool = toolRegistry.find(t => t.name === toolName);
    if (!tool) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${toolName}` } });
    }
    try {
      const result = await executeTool(tool, toolArgs);
      return c.json({ jsonrpc: '2.0', id, result });
    } catch (e: any) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
    }
  }

  if (method === 'notifications/initialized') {
    return c.json({ jsonrpc: '2.0', id, result: {} });
  }

  return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
});

loadCredentials().then(async () => {
  toolRegistry = await buildTools();
  console.log(`\n🔐 GARZA OS Nomad MCP Gateway v1.0.0`);
  console.log(`📦 Stack: nomad (business operations)`);
  console.log(`🛠  Tools: ${toolRegistry.length}`);
  const cats = [...new Set(toolRegistry.map(t => t.name.split('.')[0]))];
  for (const cat of cats) {
    const count = toolRegistry.filter(t => t.name.startsWith(cat + '.')).length;
    console.log(`   ${cat}: ${count} tools`);
  }
  console.log(`🚀 Listening on port ${PORT}\n`);
  serve({ fetch: app.fetch, port: PORT });
});
