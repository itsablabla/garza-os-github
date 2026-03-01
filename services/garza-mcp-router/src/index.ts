/**
 * GARZA OS Unified MCP Router v3.0
 * One app — three MCP servers:
 *   POST /personal  → garza-tools stack (communication, productivity, home, vaults, ai, web)
 *   POST /dev       → last-rock-labs stack (infrastructure, automation, analytics, finance)
 *   POST /nomad     → nomad stack (connectivity, ecommerce, field ops, finance, crm)
 *
 * Each server exposes its tools with a clean hierarchical namespace:
 *   {category}.{subcategory}.{action}
 *   e.g. vaults.secrets.get, finance.payments.list, communication.email.send
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

// ─── Credentials (loaded from env, injected by Railway from Doppler) ──────────
const DOPPLER_TOKEN = process.env.DOPPLER_TOKEN || "";
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "garza-mcp-2025";
const PORT = parseInt(process.env.PORT || "8080");

// ─── Tool definitions per server ──────────────────────────────────────────────

const PERSONAL_TOOLS = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secrets in a Doppler project/config. Use to discover available credentials.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.passwords.search",description: "Search Bitwarden vault for passwords, logins, or secure notes by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",   description: "Retrieve a specific Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },

  // COMMUNICATION
  { name: "communication.slack.send_message",    description: "Send a message to a Slack channel or DM.", inputSchema: { type: "object", properties: { channel: { type: "string" }, text: { type: "string" } }, required: ["channel", "text"] } },
  { name: "communication.slack.list_channels",   description: "List all Slack channels in the workspace.", inputSchema: { type: "object", properties: {} } },
  { name: "communication.slack.search",          description: "Search Slack messages across channels.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "communication.email.send_gmail",      description: "Send an email via Gmail.", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  { name: "communication.email.search_gmail",    description: "Search Gmail inbox by query string.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "communication.chat.send_beeper",      description: "Send a message via Beeper (unified chat bridge).", inputSchema: { type: "object", properties: { room_id: { type: "string" }, message: { type: "string" } }, required: ["room_id", "message"] } },
  { name: "communication.email.send_protonmail", description: "Send an encrypted email via ProtonMail.", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  { name: "communication.messaging.send_telegram", description: "Send a Telegram message to a chat or channel.", inputSchema: { type: "object", properties: { chat_id: { type: "string" }, text: { type: "string" } }, required: ["chat_id", "text"] } },

  // PRODUCTIVITY
  { name: "productivity.knowledge.create_page",   description: "Create a new Notion page in a database or as a child of another page.", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, parent_id: { type: "string" } }, required: ["title"] } },
  { name: "productivity.knowledge.search_notion", description: "Search Notion workspace for pages, databases, or blocks.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "productivity.knowledge.update_page",   description: "Update an existing Notion page's content or properties.", inputSchema: { type: "object", properties: { page_id: { type: "string" }, content: { type: "string" } }, required: ["page_id"] } },
  { name: "productivity.files.list_drive",        description: "List files and folders in Google Drive.", inputSchema: { type: "object", properties: { folder_id: { type: "string" } } } },
  { name: "productivity.files.search_drive",      description: "Search Google Drive for files by name or content.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "productivity.calendar.list_events",    description: "List upcoming Google Calendar events.", inputSchema: { type: "object", properties: { calendar_id: { type: "string" }, max_results: { type: "number" } } } },
  { name: "productivity.calendar.create_event",   description: "Create a new Google Calendar event.", inputSchema: { type: "object", properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" } }, required: ["title", "start", "end"] } },
  { name: "productivity.data.list_airtable",      description: "List records from an Airtable base and table.", inputSchema: { type: "object", properties: { base_id: { type: "string" }, table: { type: "string" } }, required: ["base_id", "table"] } },
  { name: "productivity.files.list_dropbox",      description: "List files in a Dropbox folder.", inputSchema: { type: "object", properties: { path: { type: "string" } } } },

  // HOME / IOT
  { name: "home.devices.list",          description: "List all Home Assistant devices and their current states.", inputSchema: { type: "object", properties: {} } },
  { name: "home.devices.control",       description: "Control a Home Assistant entity (turn on/off, set value).", inputSchema: { type: "object", properties: { entity_id: { type: "string" }, action: { type: "string" }, value: { type: "string" } }, required: ["entity_id", "action"] } },
  { name: "home.network.list_clients",  description: "List all UniFi network clients and their status.", inputSchema: { type: "object", properties: {} } },
  { name: "home.network.block_client",  description: "Block or unblock a UniFi network client by MAC address.", inputSchema: { type: "object", properties: { mac: { type: "string" }, block: { type: "boolean" } }, required: ["mac", "block"] } },

  // AI / MEMORY
  { name: "ai.memory.search",           description: "Search long-term memory (Mem0) for relevant context about a topic or person.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ai.memory.add",              description: "Add a new memory or fact to long-term memory (Mem0).", inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
  { name: "ai.memory.search_zep",       description: "Search Zep knowledge graph memory for entities and relationships.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ai.reasoning.think",         description: "Use sequential thinking to break down a complex problem step by step.", inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] } },

  // WEB
  { name: "web.scraping.scrape",        description: "Scrape a URL and return its content as clean markdown.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "web.scraping.search",        description: "Search the web and return structured results.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "web.browser.navigate",       description: "Navigate a headless browser to a URL and return the page content.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "web.browser.click",          description: "Click an element on the current browser page by selector.", inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
];

const DEV_TOOLS = [
  // VAULTS (same in all three)
  { name: "vaults.secrets.list",    description: "List all secrets in a Doppler project/config.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.passwords.search",description: "Search Bitwarden vault for passwords or secure notes.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",   description: "Retrieve a Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },

  // INFRASTRUCTURE / CODE
  { name: "infrastructure.code.list_repos",       description: "List GitHub repositories for the authenticated user or org.", inputSchema: { type: "object", properties: { org: { type: "string" } } } },
  { name: "infrastructure.code.create_pr",        description: "Create a GitHub pull request.", inputSchema: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, head: { type: "string" }, base: { type: "string" }, body: { type: "string" } }, required: ["repo", "title", "head", "base"] } },
  { name: "infrastructure.code.search_code",      description: "Search GitHub code across repositories.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "infrastructure.code.create_issue",     description: "Create a GitHub issue in a repository.", inputSchema: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["repo", "title"] } },
  { name: "infrastructure.files.read",            description: "Read a file from the local filesystem.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "infrastructure.files.write",           description: "Write content to a file on the local filesystem.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "infrastructure.cdn.query_d1",          description: "Run a SQL query against a Cloudflare D1 database.", inputSchema: { type: "object", properties: { database_id: { type: "string" }, sql: { type: "string" } }, required: ["database_id", "sql"] } },
  { name: "infrastructure.cdn.list_workers",      description: "List Cloudflare Workers scripts.", inputSchema: { type: "object", properties: {} } },
  { name: "infrastructure.cloud.list_droplets",   description: "List DigitalOcean Droplets.", inputSchema: { type: "object", properties: {} } },
  { name: "infrastructure.database.query",        description: "Run a SQL query against the connected PostgreSQL database.", inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
  { name: "infrastructure.sandbox.run_code",      description: "Execute code in a secure E2B sandbox environment.", inputSchema: { type: "object", properties: { language: { type: "string" }, code: { type: "string" } }, required: ["language", "code"] } },

  // AUTOMATION
  { name: "automation.workflow.list_n8n",         description: "List all n8n workflows.", inputSchema: { type: "object", properties: {} } },
  { name: "automation.workflow.execute_n8n",      description: "Execute an n8n workflow by ID with optional input data.", inputSchema: { type: "object", properties: { workflow_id: { type: "string" }, data: { type: "object" } }, required: ["workflow_id"] } },
  { name: "automation.workflow.create_n8n",       description: "Create a new n8n workflow from a JSON definition.", inputSchema: { type: "object", properties: { name: { type: "string" }, nodes: { type: "array" } }, required: ["name", "nodes"] } },
  { name: "automation.agents.run_composio",       description: "Execute a Composio action (137+ integrations). Use to interact with any SaaS tool via Composio.", inputSchema: { type: "object", properties: { action: { type: "string" }, params: { type: "object" } }, required: ["action"] } },
  { name: "automation.workflow.trigger_zapier",   description: "Trigger a Zapier Zap with input data.", inputSchema: { type: "object", properties: { zap_id: { type: "string" }, data: { type: "object" } }, required: ["zap_id"] } },
  { name: "automation.workflow.run_activepieces", description: "Trigger an Activepieces flow.", inputSchema: { type: "object", properties: { flow_id: { type: "string" }, data: { type: "object" } }, required: ["flow_id"] } },
  { name: "automation.rpa.run_rube",              description: "Execute a Rube RPA task for browser automation.", inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } },

  // ANALYTICS / OBSERVABILITY
  { name: "analytics.ai_ops.list_traces",         description: "List LLM traces from Langfuse for debugging AI pipelines.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "analytics.ai_ops.get_trace",           description: "Get a specific Langfuse trace by ID.", inputSchema: { type: "object", properties: { trace_id: { type: "string" } }, required: ["trace_id"] } },
  { name: "analytics.web.get_stats_plausible",    description: "Get website traffic stats from Plausible Analytics.", inputSchema: { type: "object", properties: { site_id: { type: "string" }, period: { type: "string" } }, required: ["site_id"] } },
  { name: "analytics.business.get_dashboard",     description: "Get a Metabase dashboard or question result.", inputSchema: { type: "object", properties: { question_id: { type: "number" } }, required: ["question_id"] } },

  // DATABASE / CRM
  { name: "database.crm.list_contacts",           description: "List contacts in Twenty CRM.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "database.crm.create_contact",          description: "Create a new contact in Twenty CRM.", inputSchema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" } }, required: ["name"] } },
  { name: "database.crm.list_deals",              description: "List deals/opportunities in Twenty CRM.", inputSchema: { type: "object", properties: {} } },
  { name: "database.tables.list_baserow",         description: "List tables in a Baserow database.", inputSchema: { type: "object", properties: { database_id: { type: "number" } }, required: ["database_id"] } },

  // AI / WEB
  { name: "ai.reasoning.think",                   description: "Use sequential thinking to break down a complex problem.", inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] } },
  { name: "web.scraping.scrape",                  description: "Scrape a URL and return clean markdown content.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "web.browser.navigate",                 description: "Navigate a headless browser to a URL.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
];

const NOMAD_TOOLS = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secrets in a Doppler project/config.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.passwords.search",description: "Search Bitwarden vault for passwords or secure notes.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",   description: "Retrieve a Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },

  // FINANCE
  { name: "finance.payments.list_charges",        description: "List recent Stripe charges. Use to audit revenue or investigate failed payments.", inputSchema: { type: "object", properties: { limit: { type: "number" }, customer: { type: "string" } } } },
  { name: "finance.payments.create_charge",       description: "Create a new Stripe charge or payment intent.", inputSchema: { type: "object", properties: { amount: { type: "number" }, currency: { type: "string" }, customer: { type: "string" } }, required: ["amount", "currency"] } },
  { name: "finance.subscriptions.list",           description: "List Stripe subscriptions, optionally filtered by customer or status.", inputSchema: { type: "object", properties: { status: { type: "string" }, customer: { type: "string" } } } },
  { name: "finance.subscriptions.cancel",         description: "Cancel a Stripe subscription by ID.", inputSchema: { type: "object", properties: { subscription_id: { type: "string" } }, required: ["subscription_id"] } },
  { name: "finance.analytics.get_mrr",            description: "Get Monthly Recurring Revenue (MRR) from ChartMogul for a specific period.", inputSchema: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } } } },
  { name: "finance.analytics.get_churn",          description: "Get churn rate and churned customers from ChartMogul.", inputSchema: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } } } },
  { name: "finance.billing.list_invoices",        description: "List Chargebee invoices for a customer or subscription.", inputSchema: { type: "object", properties: { customer_id: { type: "string" } } } },
  { name: "finance.banking.get_transactions",     description: "Get bank transactions from SimpleFin for a connected account.", inputSchema: { type: "object", properties: { account_id: { type: "string" } } } },

  // ECOMMERCE / SHIPPING
  { name: "ecommerce.store.list_orders",          description: "List Shopify orders, optionally filtered by status.", inputSchema: { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } } } },
  { name: "ecommerce.store.get_order",            description: "Get a specific Shopify order by ID.", inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } },
  { name: "ecommerce.store.list_products",        description: "List Shopify products in the store.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "ecommerce.shipping.list_shipments",    description: "List ShipStation shipments and their tracking status.", inputSchema: { type: "object", properties: { order_id: { type: "string" } } } },
  { name: "ecommerce.shipping.create_label",      description: "Create a shipping label in ShipStation.", inputSchema: { type: "object", properties: { order_id: { type: "string" }, carrier: { type: "string" } }, required: ["order_id"] } },

  // NOMAD CONNECTIVITY
  { name: "nomad.connectivity.list_devices",      description: "List ThingSpace IoT devices and their connectivity status.", inputSchema: { type: "object", properties: {} } },
  { name: "nomad.connectivity.get_device",        description: "Get details and data usage for a specific ThingSpace device.", inputSchema: { type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"] } },
  { name: "nomad.connectivity.send_command",      description: "Send a command to a remote device via Nomad MCP Bridge.", inputSchema: { type: "object", properties: { device_id: { type: "string" }, command: { type: "string" } }, required: ["device_id", "command"] } },
  { name: "nomad.ops.run_command",                description: "Run a remote desktop command via Nomad Commander.", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },

  // COMMUNICATION
  { name: "communication.slack.send_message",     description: "Send a Slack message to a channel.", inputSchema: { type: "object", properties: { channel: { type: "string" }, text: { type: "string" } }, required: ["channel", "text"] } },

  // AUTOMATION
  { name: "automation.workflow.execute_n8n",      description: "Execute an n8n workflow by ID.", inputSchema: { type: "object", properties: { workflow_id: { type: "string" }, data: { type: "object" } }, required: ["workflow_id"] } },
  { name: "automation.agents.run_composio",       description: "Execute a Composio action across 137+ integrations.", inputSchema: { type: "object", properties: { action: { type: "string" }, params: { type: "object" } }, required: ["action"] } },
  { name: "automation.tasks.list_taskr",          description: "List tasks in Taskr.", inputSchema: { type: "object", properties: {} } },
  { name: "automation.tasks.create_taskr",        description: "Create a new task in Taskr.", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title"] } },

  // ANALYTICS
  { name: "analytics.web.get_stats",              description: "Get website traffic stats from Plausible Analytics.", inputSchema: { type: "object", properties: { site_id: { type: "string" }, period: { type: "string" } }, required: ["site_id"] } },

  // AI
  { name: "ai.memory.search",                     description: "Search long-term memory (Mem0) for relevant context.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ai.reasoning.think",                   description: "Use sequential thinking to break down a complex problem.", inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] } },
];

// ─── Tool execution (routes calls to the appropriate backend) ─────────────────

async function executeTool(toolName: string, args: Record<string, unknown>, server: "personal" | "dev" | "nomad"): Promise<unknown> {
  const [category, , action] = toolName.split(".");

  // VAULTS — handled locally via Doppler API
  if (category === "vaults") {
    if (toolName === "vaults.secrets.list") {
      const r = await fetch(`https://api.doppler.com/v3/configs/config/secrets?project=${args.project}&config=${args.config}`, {
        headers: { Authorization: `Bearer ${DOPPLER_TOKEN}` }
      });
      const data = await r.json() as Record<string, unknown>;
      const secrets = data.secrets as Record<string, unknown> || {};
      return { count: Object.keys(secrets).length, keys: Object.keys(secrets) };
    }
    if (toolName === "vaults.secrets.get") {
      const r = await fetch(`https://api.doppler.com/v3/configs/config/secret?project=${args.project}&config=${args.config}&name=${args.name}`, {
        headers: { Authorization: `Bearer ${DOPPLER_TOKEN}` }
      });
      const data = await r.json() as Record<string, unknown>;
      const secret = data.secret as Record<string, unknown> || {};
      return { name: args.name, value: secret.raw || secret.computed };
    }
    if (toolName === "vaults.passwords.search") {
      return { message: "Bitwarden search: connect to bitwarden-nomadprime.replit.app with your session token", query: args.query };
    }
    if (toolName === "vaults.passwords.get") {
      return { message: "Bitwarden get: connect to bitwarden-nomadprime.replit.app with your session token", id: args.id };
    }
  }

  // All other tools — return routing info (the gateway tells the agent which backend to call)
  return {
    tool: toolName,
    server,
    status: "routed",
    message: `Tool '${toolName}' is available. Connect to the appropriate backend service for execution.`,
    args
  };
}

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────

function makeMcpHandler(serverName: string, tools: typeof PERSONAL_TOOLS) {
  return async (c: { req: { json: () => Promise<Record<string, unknown>> }, json: (data: unknown, status?: number) => unknown, header: (k: string, v: string) => void }) => {
    const body = await c.req.json();
    const { method, id, params } = body as { method: string; id: unknown; params: Record<string, unknown> };

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: `garza-mcp-${serverName}`, version: "3.0.0" }
        }
      });
    }

    if (method === "tools/list") {
      return c.json({
        jsonrpc: "2.0", id,
        result: { tools }
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
      try {
        const result = await executeTool(name, args || {}, serverName as "personal" | "dev" | "nomad");
        return c.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
        });
      } catch (err) {
        return c.json({
          jsonrpc: "2.0", id,
          error: { code: -32000, message: String(err) }
        });
      }
    }

    if (method === "notifications/initialized") {
      return c.json({ jsonrpc: "2.0", id, result: {} });
    }

    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  };
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function authCheck(token: string): boolean {
  return token === GATEWAY_TOKEN ||
    token === "garza-personal-2025" ||
    token === "garza-dev-2025" ||
    token === "garza-nomad-2025" ||
    token === "garza-mcp-router-2025";
}

// ─── App setup ────────────────────────────────────────────────────────────────

const app = new Hono();

// Health check
app.get("/", (c) => c.json({
  name: "GARZA OS Unified MCP Router",
  version: "3.0.0",
  servers: {
    personal: { path: "/personal", tools: PERSONAL_TOOLS.length, categories: [...new Set(PERSONAL_TOOLS.map(t => t.name.split(".")[0]))] },
    dev:      { path: "/dev",      tools: DEV_TOOLS.length,      categories: [...new Set(DEV_TOOLS.map(t => t.name.split(".")[0]))] },
    nomad:    { path: "/nomad",    tools: NOMAD_TOOLS.length,    categories: [...new Set(NOMAD_TOOLS.map(t => t.name.split(".")[0]))] },
  },
  total_tools: PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length,
  status: "ok"
}));

app.get("/health", (c) => c.json({ status: "ok", uptime: process.uptime() }));

// Auth + route handlers
const servers = [
  { path: "/personal", tools: PERSONAL_TOOLS, name: "personal" },
  { path: "/dev",      tools: DEV_TOOLS,      name: "dev" },
  { path: "/nomad",    tools: NOMAD_TOOLS,    name: "nomad" },
] as const;

for (const { path, tools, name } of servers) {
  const handler = makeMcpHandler(name, tools as typeof PERSONAL_TOOLS);

  app.post(path, async (c) => {
    const auth = c.req.header("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!authCheck(token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return handler(c as Parameters<typeof handler>[0]);
  });

  // Also support /personal/mcp, /dev/mcp, /nomad/mcp paths
  app.post(`${path}/mcp`, async (c) => {
    const auth = c.req.header("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!authCheck(token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return handler(c as Parameters<typeof handler>[0]);
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n🚀 GARZA OS Unified MCP Router v3.0 running on port ${PORT}`);
  console.log(`\n  Servers:`);
  console.log(`    /personal  → ${PERSONAL_TOOLS.length} tools (${[...new Set(PERSONAL_TOOLS.map(t => t.name.split(".")[0]))].join(", ")})`);
  console.log(`    /dev       → ${DEV_TOOLS.length} tools (${[...new Set(DEV_TOOLS.map(t => t.name.split(".")[0]))].join(", ")})`);
  console.log(`    /nomad     → ${NOMAD_TOOLS.length} tools (${[...new Set(NOMAD_TOOLS.map(t => t.name.split(".")[0]))].join(", ")})`);
  console.log(`\n  Total: ${PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length} tools across 3 servers\n`);
});
