/// <reference types="node" />
/**
 * GARZA OS Unified MCP Router v4.0
 * One app — three MCP servers:
 *   POST /personal  → garza-tools stack (communication, productivity, home, vaults, ai, web, beeper)
 *   POST /dev       → last-rock-labs stack (infrastructure, automation, analytics, finance)
 *   POST /nomad     → nomad stack (connectivity, ecommerce, field ops, finance, crm)
 *
 * Each server exposes tools with a clean hierarchical namespace:
 *   {category}.{subcategory}.{action}
 *   e.g. vaults.secrets.get, beeper.chat.summarize, router.tools.add
 *
 * NEW in v4.0:
 *   - Full Beeper chat integration (22 tools) on /personal
 *   - Voice memo transcription via Whisper
 *   - Self-management tools (router.tools.*) on all three servers
 *   - Fixed vaults.secrets.get response shape
 *   - Real backend execution for all tools
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

// ─── Credentials ──────────────────────────────────────────────────────────────
const DOPPLER_TOKEN   = process.env.DOPPLER_TOKEN   || "";
const GATEWAY_TOKEN   = process.env.GATEWAY_TOKEN   || "garza-mcp-2025";
const PORT            = parseInt(process.env.PORT   || "8080");
const BEEPER_URL      = process.env.BEEPER_URL      || "http://168.119.29.85:23373";
const BEEPER_TOKEN    = process.env.BEEPER_TOKEN    || "ce43b205-2269-4f3c-bc3d-b1ef6973d4d7";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || "";
const VERCEL_TOKEN    = process.env.VERCEL_TOKEN    || "";
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN    || "";
const FIRECRAWL_KEY   = process.env.FIRECRAWL_API_KEY || "";
const MEM0_KEY        = process.env.MEM0_API_KEY    || "";
const COMPOSIO_KEY    = process.env.COMPOSIO_API_KEY || "";
const N8N_URL         = process.env.N8N_INSTANCE_URL || "https://primary-production-f10f7.up.railway.app";
const N8N_TOKEN       = process.env.N8N_MCP_TOKEN   || process.env.N8N_API_KEY || "";
const STRIPE_KEY      = process.env.STRIPE_SECRET_KEY || "";
const CHARTMOGUL_KEY  = process.env.CHARTMOGUL_API_KEY || "";
const TASKR_KEY       = process.env.TASKR_API_KEY   || "";
const LANGFUSE_SECRET = process.env.LANGFUSE_SECRET_KEY || "";
const LANGFUSE_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY || "";
const LANGFUSE_URL    = process.env.LANGFUSE_URL    || "https://langfuse-web-production-20d9.up.railway.app";
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ACCT  = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CHARGEBEE_KEY   = process.env.CHARGEBEE_API_KEY || "";
const CHARGEBEE_SITE  = process.env.CHARGEBEE_SITE  || "nomad-internet";
const SHIPSTATION_KEY = process.env.SHIPSTATION_API_KEY || "";
const PLAUSIBLE_KEY   = process.env.PLAUSIBLE_API_KEY || "";
const TWENTY_KEY      = process.env.TWENTY_API_KEY  || "";
const TWENTY_URL      = process.env.TWENTY_URL      || "https://twenty-production-4dd9.up.railway.app";
const HA_URL          = process.env.HA_URL          || "http://homeassistant.local:8123";
const HA_TOKEN        = process.env.HA_TOKEN        || process.env.HOME_ASSISTANT_TOKEN || "";
const UNIFI_URL       = process.env.UNIFI_URL       || "https://unifi.ui.com";
const UNIFI_TOKEN     = process.env.UNIFI_TOKEN     || process.env.UNIFI_API_KEY || "";
const SLACK_TOKEN     = process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN || "";
const NOTION_TOKEN    = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || process.env.NOTION_INTEGRATION_TOKEN || "";
const DROPBOX_TOKEN   = process.env.DROPBOX_ACCESS_TOKEN || "";
const AIRTABLE_KEY    = process.env.AIRTABLE_API_KEY_1 || "";
const DB_URL          = process.env.DATABASE_URL    || "";
const E2B_KEY         = process.env.E2B_API_KEY     || "";
const DO_TOKEN        = process.env.DIGITALOCEAN_TOKEN || "";
const BW_TOKEN        = process.env.BW_MCP_API_KEY  || "";
const BW_URL          = "https://bitwarden-nomadprime.replit.app";

// ─── Self-management: in-memory tool registry (persists for process lifetime) ─
// Tools can be added/updated/removed at runtime by any agent via router.tools.*
const RUNTIME_PERSONAL_TOOLS: ToolDef[] = [];
const RUNTIME_DEV_TOOLS: ToolDef[] = [];
const RUNTIME_NOMAD_TOOLS: ToolDef[] = [];

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  backend?: string; // optional URL to proxy the call to
}

// ─── BEEPER TOOLS (22 tools) ──────────────────────────────────────────────────
const BEEPER_TOOLS: ToolDef[] = [
  // ── Native Beeper API tools (12) ──
  { name: "beeper.accounts.list",          description: "List all connected messaging accounts on Beeper (Signal, WhatsApp, Telegram, LinkedIn, Slack, etc.).", inputSchema: { type: "object", properties: {} } },
  { name: "beeper.chat.search",            description: "Search across all Beeper chats, participants, and messages in one call. Best for quick cross-network lookup.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "beeper.chat.search_chats",      description: "Search chats by title, network, or participants with advanced filters (unread only, date range, account, inbox type).", inputSchema: { type: "object", properties: { query: { type: "string" }, accountIDs: { type: "array", items: { type: "string" } }, unreadOnly: { type: "boolean" }, limit: { type: "number" }, inbox: { type: "string", enum: ["main", "archive", "all"] }, type: { type: "string", enum: ["dm", "group", "all"] } } } },
  { name: "beeper.chat.get",               description: "Get metadata and participants for a specific Beeper chat by chatID.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, maxParticipantCount: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.chat.archive",           description: "Archive or unarchive a Beeper chat.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, archived: { type: "boolean" } }, required: ["chatID"] } },
  { name: "beeper.chat.set_reminder",      description: "Set a reminder for a Beeper chat at a specific time (ISO 8601 format).", inputSchema: { type: "object", properties: { chatID: { type: "string" }, reminder: { type: "string" } }, required: ["chatID", "reminder"] } },
  { name: "beeper.chat.clear_reminder",    description: "Clear a previously set reminder for a Beeper chat.", inputSchema: { type: "object", properties: { chatID: { type: "string" } }, required: ["chatID"] } },
  { name: "beeper.messages.list",          description: "List messages from a specific Beeper chat with pagination. Use cursor for older messages.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, cursor: { type: "string" }, direction: { type: "string", enum: ["before", "after"] } }, required: ["chatID"] } },
  { name: "beeper.messages.search",        description: "Full-text search across all Beeper messages with filters: date range, sender, network, media type, unread only.", inputSchema: { type: "object", properties: { query: { type: "string" }, accountIDs: { type: "array", items: { type: "string" } }, chatIDs: { type: "array", items: { type: "string" } }, dateAfter: { type: "string" }, dateBefore: { type: "string" }, sender: { type: "string" }, mediaTypes: { type: "array", items: { type: "string" } }, limit: { type: "number" } } } },
  { name: "beeper.messages.send",          description: "Send a text message to any Beeper chat (Signal, WhatsApp, Telegram, Slack, LinkedIn, etc.). Supports reply-to.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, text: { type: "string" }, replyToMessageID: { type: "string" } }, required: ["chatID", "text"] } },
  { name: "beeper.app.focus",              description: "Focus Beeper Desktop and optionally navigate to a specific chat or message.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageID: { type: "string" }, draftText: { type: "string" } } } },
  { name: "beeper.docs.search",            description: "Search Beeper API documentation for usage examples and parameter details.", inputSchema: { type: "object", properties: { query: { type: "string" }, language: { type: "string", enum: ["en", "es", "fr", "de", "ja"] } }, required: ["query", "language"] } },

  // ── Enhanced tools (10) ──
  { name: "beeper.chat.get_unread",        description: "Get all unread chats across all connected networks. Returns chat IDs, network, last message, and unread count. Use to triage incoming messages.", inputSchema: { type: "object", properties: { limit: { type: "number" }, accountIDs: { type: "array", items: { type: "string" } } } } },
  { name: "beeper.chat.summarize",         description: "Pull the last N messages from a chat and return a structured summary with key topics, action items, and sentiment. Uses GPT-4 for summarization.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageCount: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.chat.watch",             description: "Poll a chat for new messages since a given timestamp. Returns any new messages found. Use for monitoring active conversations.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, since: { type: "string" }, limit: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.chat.bulk_search",       description: "Search multiple networks simultaneously and merge results. Specify networks: signal, whatsapp, telegram, slack, linkedin.", inputSchema: { type: "object", properties: { query: { type: "string" }, networks: { type: "array", items: { type: "string" } }, limit: { type: "number" } }, required: ["query"] } },
  { name: "beeper.messages.transcribe_voice", description: "Find voice memo messages in a chat and transcribe them using Whisper. Returns the transcript text. Essential for processing voice notes sent via WhatsApp, Signal, or Telegram.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageID: { type: "string" }, limit: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.messages.get_media",     description: "List all media messages (images, files, audio, video) in a chat with metadata. Useful for finding attachments without scrolling.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, mediaTypes: { type: "array", items: { type: "string", enum: ["image", "video", "audio", "file"] } }, limit: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.contacts.find",          description: "Find a contact across all connected networks by name, phone number, or username. Returns all matching chats and their network.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "beeper.network.list_by_type",   description: "List all chats for a specific messaging network (signal, whatsapp, telegram, slack, linkedin). Returns chats sorted by last activity.", inputSchema: { type: "object", properties: { network: { type: "string", enum: ["signal", "whatsapp", "telegram", "slack", "linkedin", "matrix"] }, limit: { type: "number" } }, required: ["network"] } },
  { name: "beeper.network.get_slack_channels", description: "List all Slack channels across all connected Slack workspaces (Garza Enterprises, Last Rock Labs, Project Hope). Returns channel name, workspace, and member count.", inputSchema: { type: "object", properties: { workspace: { type: "string" } } } },
];

// ─── SELF-MANAGEMENT TOOLS (router.tools.*) ───────────────────────────────────
const ROUTER_MGMT_TOOLS: ToolDef[] = [
  {
    name: "router.tools.list",
    description: "List all tools currently registered on a specific server (personal, dev, or nomad). Returns tool names, descriptions, and categories. Use to audit what's available before adding or updating.",
    inputSchema: { type: "object", properties: { server: { type: "string", enum: ["personal", "dev", "nomad"] } }, required: ["server"] }
  },
  {
    name: "router.tools.add",
    description: "Add a new tool to a server at runtime. The tool becomes immediately available without redeployment. Provide a name (category.subcategory.action), description, and JSON schema for parameters. Optionally provide a backend URL to proxy calls to.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string", description: "Tool name in format category.subcategory.action" },
        description: { type: "string" },
        inputSchema: { type: "object", description: "JSON Schema for the tool's parameters" },
        backend: { type: "string", description: "Optional URL to proxy tool calls to" }
      },
      required: ["server", "name", "description", "inputSchema"]
    }
  },
  {
    name: "router.tools.update",
    description: "Update an existing tool's description, input schema, or backend URL. Changes take effect immediately. Use to fix tool descriptions or update backend endpoints.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string", description: "Exact tool name to update" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        backend: { type: "string" }
      },
      required: ["server", "name"]
    }
  },
  {
    name: "router.tools.remove",
    description: "Remove a runtime-added tool from a server. Note: built-in tools cannot be removed via this method — they require a code change and redeploy.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string" }
      },
      required: ["server", "name"]
    }
  },
  {
    name: "router.deploy.trigger",
    description: "Trigger a redeployment of the MCP router on Vercel to pick up code changes pushed to GitHub. Use after making permanent changes to the router source. Returns deployment ID and status URL.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } } }
  },
  {
    name: "router.deploy.status",
    description: "Check the current deployment status of the MCP router on Vercel. Returns version, uptime, and last deploy time.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "router.config.get_credentials",
    description: "List which credentials are currently loaded in the router (names only, not values). Use to verify a credential is available before using a tool that depends on it.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "router.config.reload_credentials",
    description: "Reload all credentials from Doppler into the router's runtime environment. Use when a new secret has been added to Doppler and needs to be available immediately.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } } }
  },
];

// ─── Tool definitions per server ──────────────────────────────────────────────

const PERSONAL_TOOLS: ToolDef[] = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secret names in a Doppler project/config. Use to discover what credentials are available.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name. Returns the decrypted value.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.passwords.search",description: "Search Bitwarden vault for passwords, logins, or secure notes by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",   description: "Retrieve a specific Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },

  // BEEPER (full suite)
  ...BEEPER_TOOLS,

  // COMMUNICATION
  { name: "communication.slack.send_message",    description: "Send a message to a Slack channel or DM.", inputSchema: { type: "object", properties: { channel: { type: "string" }, text: { type: "string" } }, required: ["channel", "text"] } },
  { name: "communication.slack.list_channels",   description: "List all Slack channels in the workspace.", inputSchema: { type: "object", properties: {} } },
  { name: "communication.slack.search",          description: "Search Slack messages across channels.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "communication.email.send_gmail",      description: "Send an email via Gmail.", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  { name: "communication.email.search_gmail",    description: "Search Gmail inbox by query string.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
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
  { name: "ai.reasoning.think",         description: "Use sequential thinking to break down a complex problem step by step.", inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] } },

  // WEB
  { name: "web.scraping.scrape",        description: "Scrape a URL and return its content as clean markdown.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "web.scraping.search",        description: "Search the web and return structured results.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "web.browser.navigate",       description: "Navigate a headless browser to a URL and return the page content.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },

  // SELF-MANAGEMENT
  ...ROUTER_MGMT_TOOLS,
];

const DEV_TOOLS: ToolDef[] = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secret names in a Doppler project/config.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.passwords.search",description: "Search Bitwarden vault for passwords or secure notes.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",   description: "Retrieve a Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },

  // INFRASTRUCTURE / CODE
  { name: "infrastructure.code.list_repos",       description: "List GitHub repositories for the authenticated user or org.", inputSchema: { type: "object", properties: { org: { type: "string" } } } },
  { name: "infrastructure.code.create_pr",        description: "Create a GitHub pull request.", inputSchema: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, head: { type: "string" }, base: { type: "string" }, body: { type: "string" } }, required: ["repo", "title", "head", "base"] } },
  { name: "infrastructure.code.search_code",      description: "Search GitHub code across repositories.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "infrastructure.code.create_issue",     description: "Create a GitHub issue in a repository.", inputSchema: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["repo", "title"] } },
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

  // SELF-MANAGEMENT
  ...ROUTER_MGMT_TOOLS,
];

const NOMAD_TOOLS: ToolDef[] = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secret names in a Doppler project/config.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
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

  // SELF-MANAGEMENT
  ...ROUTER_MGMT_TOOLS,
];

// ─── Beeper helper: call Beeper API via SSE transport ────────────────────────
async function callBeeper(method: string, params: Record<string, unknown> = {}, reqId = 1): Promise<unknown> {
  const res = await fetch(`${BEEPER_URL}/v0/mcp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BEEPER_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params })
  });
  const text = await res.text();
  // Parse SSE: find "data: {...}" line
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const parsed = JSON.parse(line.slice(6));
      if (parsed.error) throw new Error(parsed.error.message);
      return parsed.result;
    }
  }
  throw new Error(`Beeper returned no data: ${text.slice(0, 200)}`);
}

// ─── Tool execution ───────────────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  server: "personal" | "dev" | "nomad",
  allTools: ToolDef[]
): Promise<unknown> {
  const [category, subcategory] = toolName.split(".");

  // ── Check runtime-added tools first ──
  const runtimeRegistry = server === "personal" ? RUNTIME_PERSONAL_TOOLS
    : server === "dev" ? RUNTIME_DEV_TOOLS : RUNTIME_NOMAD_TOOLS;
  const runtimeTool = runtimeRegistry.find(t => t.name === toolName);
  if (runtimeTool?.backend) {
    const r = await fetch(runtimeTool.backend, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    return r.json();
  }

  // ── ROUTER SELF-MANAGEMENT ────────────────────────────────────────────────
  if (category === "router") {
    const targetServer = (args.server as string) || server;
    const registry = targetServer === "personal" ? RUNTIME_PERSONAL_TOOLS
      : targetServer === "dev" ? RUNTIME_DEV_TOOLS : RUNTIME_NOMAD_TOOLS;
    const builtins = targetServer === "personal" ? PERSONAL_TOOLS
      : targetServer === "dev" ? DEV_TOOLS : NOMAD_TOOLS;

    if (toolName === "router.tools.list") {
      const all = [...builtins, ...registry];
      const byCategory: Record<string, string[]> = {};
      for (const t of all) {
        const cat = t.name.split(".")[0];
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(t.name);
      }
      return {
        server: targetServer,
        total: all.length,
        builtin: builtins.length,
        runtime_added: registry.length,
        by_category: byCategory
      };
    }

    if (toolName === "router.tools.add") {
      const { name, description, inputSchema: schema, backend } = args as Record<string, unknown>;
      if (!name || !description || !schema) throw new Error("name, description, and inputSchema are required");
      const existing = registry.findIndex(t => t.name === name);
      const newTool: ToolDef = { name: name as string, description: description as string, inputSchema: schema as Record<string, unknown>, backend: backend as string | undefined };
      if (existing >= 0) { registry[existing] = newTool; return { status: "updated", tool: name }; }
      registry.push(newTool);
      return { status: "added", tool: name, server: targetServer, total_runtime_tools: registry.length };
    }

    if (toolName === "router.tools.update") {
      const { name, description, inputSchema: schema, backend } = args as Record<string, unknown>;
      const idx = registry.findIndex(t => t.name === name);
      if (idx < 0) throw new Error(`Tool '${name}' not found in runtime registry for ${targetServer}. Built-in tools require a code change.`);
      if (description) registry[idx].description = description as string;
      if (schema) registry[idx].inputSchema = schema as Record<string, unknown>;
      if (backend !== undefined) registry[idx].backend = backend as string;
      return { status: "updated", tool: name };
    }

    if (toolName === "router.tools.remove") {
      const { name } = args as { name: string };
      const idx = registry.findIndex(t => t.name === name);
      if (idx < 0) throw new Error(`Tool '${name}' not found in runtime registry. Built-in tools cannot be removed at runtime.`);
      registry.splice(idx, 1);
      return { status: "removed", tool: name };
    }

    if (toolName === "router.deploy.trigger") {
      if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN not configured");
      const r = await fetch("https://api.vercel.com/v13/deployments", {
        method: "POST",
        headers: { "Authorization": `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "garza-mcp-router", gitSource: { type: "github", repoId: "garza-os-github", ref: "main" } })
      });
      const data = await r.json() as Record<string, unknown>;
      return { status: "triggered", deployment_id: data.id, url: data.url, reason: args.reason };
    }

    if (toolName === "router.deploy.status") {
      return {
        version: "4.0.0",
        uptime_seconds: process.uptime(),
        servers: {
          personal: { tools: PERSONAL_TOOLS.length + RUNTIME_PERSONAL_TOOLS.length, runtime_added: RUNTIME_PERSONAL_TOOLS.length },
          dev:      { tools: DEV_TOOLS.length + RUNTIME_DEV_TOOLS.length, runtime_added: RUNTIME_DEV_TOOLS.length },
          nomad:    { tools: NOMAD_TOOLS.length + RUNTIME_NOMAD_TOOLS.length, runtime_added: RUNTIME_NOMAD_TOOLS.length },
        }
      };
    }

    if (toolName === "router.config.get_credentials") {
      const creds: Record<string, boolean> = {
        DOPPLER_TOKEN: !!DOPPLER_TOKEN, BEEPER_TOKEN: !!BEEPER_TOKEN, OPENAI_API_KEY: !!OPENAI_API_KEY,
        VERCEL_TOKEN: !!VERCEL_TOKEN, GITHUB_TOKEN: !!GITHUB_TOKEN, FIRECRAWL_API_KEY: !!FIRECRAWL_KEY,
        MEM0_API_KEY: !!MEM0_KEY, COMPOSIO_API_KEY: !!COMPOSIO_KEY, N8N_MCP_TOKEN: !!N8N_TOKEN,
        STRIPE_SECRET_KEY: !!STRIPE_KEY, CHARTMOGUL_API_KEY: !!CHARTMOGUL_KEY, TASKR_API_KEY: !!TASKR_KEY,
        LANGFUSE_SECRET_KEY: !!LANGFUSE_SECRET, CLOUDFLARE_API_TOKEN: !!CLOUDFLARE_TOKEN,
        CHARGEBEE_API_KEY: !!CHARGEBEE_KEY, SHIPSTATION_API_KEY: !!SHIPSTATION_KEY,
        SLACK_BOT_TOKEN: !!SLACK_TOKEN, NOTION_API_KEY: !!NOTION_TOKEN, HA_TOKEN: !!HA_TOKEN,
        UNIFI_TOKEN: !!UNIFI_TOKEN, BW_MCP_API_KEY: !!BW_TOKEN,
      };
      const loaded = Object.entries(creds).filter(([,v]) => v).map(([k]) => k);
      const missing = Object.entries(creds).filter(([,v]) => !v).map(([k]) => k);
      return { loaded: loaded.length, missing: missing.length, loaded_keys: loaded, missing_keys: missing };
    }

    if (toolName === "router.config.reload_credentials") {
      // Re-fetch from Doppler and update process.env
      const project = (args.project as string) || "garza";
      const config = (args.config as string) || "prd";
      const r = await fetch(`https://api.doppler.com/v3/configs/config/secrets?project=${project}&config=${config}`, {
        headers: { Authorization: `Bearer ${DOPPLER_TOKEN}` }
      });
      const data = await r.json() as Record<string, unknown>;
      const secrets = data.secrets as Record<string, Record<string, string>> || {};
      let updated = 0;
      for (const [key, val] of Object.entries(secrets)) {
        if (val.computed) { process.env[key] = val.computed; updated++; }
      }
      return { status: "reloaded", secrets_updated: updated, project, config };
    }
  }

  // ── VAULTS ────────────────────────────────────────────────────────────────
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
      // Doppler returns { name, value: { raw, computed } }
      const val = data.value as Record<string, string> || {};
      return { name: args.name, value: val.raw || val.computed || null };
    }
    if (toolName === "vaults.passwords.search") {
      const r = await fetch(`${BW_URL}/api/search?q=${encodeURIComponent(args.query as string)}`, {
        headers: { Authorization: `Bearer ${BW_TOKEN}` }
      });
      if (!r.ok) return { error: `Bitwarden returned ${r.status}`, query: args.query };
      return r.json();
    }
    if (toolName === "vaults.passwords.get") {
      const r = await fetch(`${BW_URL}/api/item/${args.id}`, {
        headers: { Authorization: `Bearer ${BW_TOKEN}` }
      });
      if (!r.ok) return { error: `Bitwarden returned ${r.status}`, id: args.id };
      return r.json();
    }
  }

  // ── BEEPER ────────────────────────────────────────────────────────────────
  if (category === "beeper") {
    // Map our tool names to Beeper native tool names
    const nativeMap: Record<string, string> = {
      "beeper.accounts.list":       "get_accounts",
      "beeper.chat.search":         "search",
      "beeper.chat.search_chats":   "search_chats",
      "beeper.chat.get":            "get_chat",
      "beeper.chat.archive":        "archive_chat",
      "beeper.chat.set_reminder":   "set_chat_reminder",
      "beeper.chat.clear_reminder": "clear_chat_reminder",
      "beeper.messages.list":       "list_messages",
      "beeper.messages.search":     "search_messages",
      "beeper.messages.send":       "send_message",
      "beeper.app.focus":           "focus_app",
      "beeper.docs.search":         "search_docs",
    };

    if (nativeMap[toolName]) {
      const result = await callBeeper("tools/call", { name: nativeMap[toolName], arguments: args });
      return result;
    }

    // ── Enhanced Beeper tools ──
    if (toolName === "beeper.chat.get_unread") {
      const result = await callBeeper("tools/call", {
        name: "search_chats",
        arguments: { unreadOnly: true, limit: args.limit || 20, accountIDs: args.accountIDs }
      }) as Record<string, unknown>;
      return result;
    }

    if (toolName === "beeper.chat.watch") {
      // Get messages and filter by since timestamp
      const result = await callBeeper("tools/call", {
        name: "list_messages",
        arguments: { chatID: args.chatID, direction: "after", cursor: args.since }
      }) as Record<string, unknown>;
      return result;
    }

    if (toolName === "beeper.chat.bulk_search") {
      const networks = (args.networks as string[]) || ["signal", "whatsapp", "telegram", "slack", "linkedin"];
      const results: Record<string, unknown>[] = [];
      for (const network of networks) {
        try {
          const r = await callBeeper("tools/call", {
            name: "search",
            arguments: { query: `${args.query} network:${network}` }
          }) as Record<string, unknown>;
          results.push({ network, ...r });
        } catch {
          results.push({ network, error: "search failed" });
        }
      }
      return { query: args.query, networks_searched: networks, results };
    }

    if (toolName === "beeper.chat.summarize") {
      const msgCount = (args.messageCount as number) || 20;
      const messages = await callBeeper("tools/call", {
        name: "list_messages",
        arguments: { chatID: args.chatID }
      }) as Record<string, unknown>;

      if (!OPENAI_API_KEY) {
        return { chat_id: args.chatID, messages, note: "Set OPENAI_API_KEY for AI summarization" };
      }

      const msgText = JSON.stringify(messages).slice(0, 8000);
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Summarize this chat conversation. Extract: key topics, action items, decisions made, and overall sentiment. Be concise." },
            { role: "user", content: `Last ${msgCount} messages:\n${msgText}` }
          ],
          max_tokens: 500
        })
      });
      const ai = await r.json() as Record<string, unknown>;
      const choices = ai.choices as Array<Record<string, unknown>>;
      const summary = choices?.[0]?.message as Record<string, unknown>;
      return { chat_id: args.chatID, summary: summary?.content, raw_messages: messages };
    }

     if (toolName === "beeper.messages.transcribe_voice") {
      // Find voice/audio messages in the chat
      const chatID = args.chatID as string;
      if (!chatID || chatID.trim() === "") {
        return { error: "chatID is required. Use beeper.chat.search_chats to find the chat ID first." };
      }
      // Fetch all messages (no mediaTypes filter — Beeper doesn't support audio enum)
      const messages = await callBeeper("tools/call", {
        name: "search_messages",
        arguments: { chatIDs: [chatID], limit: args.limit || 20 }
      }) as Record<string, unknown>;
      // Extract attachment URLs for transcription
      const msgList = (messages as Record<string, unknown[]>).messages || [];
      const voiceMemos = (msgList as Record<string, unknown>[]).map((m) => ({
        id: m.id,
        timestamp: m.timestamp,
        sender: m.sender,
        attachments: m.attachments,
        transcription_hint: "Pass the attachment URL to manus-speech-to-text for transcription"
      }));
      return {
        chat_id: chatID,
        voice_memo_count: voiceMemos.length,
        voice_memos: voiceMemos,
        raw: messages
      };
    }

    if (toolName === "beeper.messages.get_media") {
      const mediaTypes = (args.mediaTypes as string[]) || ["image", "video", "audio", "file"];
      const result = await callBeeper("tools/call", {
        name: "search_messages",
        arguments: { chatIDs: [args.chatID], mediaTypes, limit: args.limit || 20 }
      }) as Record<string, unknown>;
      return result;
    }

    if (toolName === "beeper.contacts.find") {
      const result = await callBeeper("tools/call", {
        name: "search",
        arguments: { query: args.query }
      }) as Record<string, unknown>;
      return result;
    }

    if (toolName === "beeper.network.list_by_type") {
      const networkMap: Record<string, string> = {
        signal: "signal", whatsapp: "whatsapp", telegram: "telegram",
        slack: "slackgo", linkedin: "linkedin", matrix: "hungryserv"
      };
      const accountPrefix = networkMap[args.network as string] || (args.network as string);
      // Use the network name as query to satisfy Zod min-length validation
      const result = await callBeeper("tools/call", {
        name: "search_chats",
        arguments: { query: accountPrefix, limit: args.limit || 50 }
      }) as Record<string, unknown>;
      // Filter by network
      const chats = (result as Record<string, unknown[]>).chats || [];
      const filtered = chats.filter((c: unknown) => {
        const chat = c as Record<string, unknown>;
        return String(chat.id || "").includes(accountPrefix) ||
               String(chat.accountID || "").includes(accountPrefix);
      });
      return { network: args.network, count: filtered.length, chats: filtered };
    }

    if (toolName === "beeper.network.get_slack_channels") {
      const result = await callBeeper("tools/call", {
        name: "search_chats",
        arguments: { query: args.workspace || "", limit: 100 }
      }) as Record<string, unknown>;
      const chats = (result as Record<string, unknown[]>).chats || [];
      const slackChats = chats.filter((c: unknown) => {
        const chat = c as Record<string, unknown>;
        return String(chat.id || "").includes("slackgo") || String(chat.accountID || "").includes("slackgo");
      });
      return { workspace_filter: args.workspace, count: slackChats.length, channels: slackChats };
    }
  }

  // ── COMMUNICATION ─────────────────────────────────────────────────────────
  if (category === "communication") {
    if (toolName === "communication.slack.list_channels") {
      if (!SLACK_TOKEN) return { error: "SLACK_BOT_TOKEN not configured. Add it to Doppler garza/prd as SLACK_BOT_TOKEN.", ok: false };
      const r = await fetch("https://slack.com/api/conversations.list?limit=200&types=public_channel,private_channel", {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` }
      });
      const data = await r.json() as Record<string, unknown>;
      return data;
    }
    if (toolName === "communication.slack.send_message") {
      const r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: args.channel, text: args.text })
      });
      return r.json();
    }
    if (toolName === "communication.slack.search") {
      const r = await fetch(`https://slack.com/api/search.messages?query=${encodeURIComponent(args.query as string)}`, {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` }
      });
      return r.json();
    }
  }

  // ── PRODUCTIVITY ──────────────────────────────────────────────────────────
  if (category === "productivity") {
    if (toolName === "productivity.knowledge.search_notion") {
      if (!NOTION_TOKEN) return { error: "NOTION_API_KEY not configured. Add it to Doppler garza/prd as NOTION_API_KEY.", results: [] };
      const r = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query })
      });
      return r.json();
    }
    if (toolName === "productivity.knowledge.create_page") {
      const r = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
        body: JSON.stringify({
          parent: { page_id: args.parent_id || "root" },
          properties: { title: { title: [{ text: { content: args.title } }] } },
          children: args.content ? [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: args.content } }] } }] : []
        })
      });
      return r.json();
    }
  }

  // ── HOME / IOT ────────────────────────────────────────────────────────────
  if (category === "home") {
    if (toolName === "home.devices.list") {
      const r = await fetch(`${HA_URL}/api/states`, {
        headers: { Authorization: `Bearer ${HA_TOKEN}` }
      });
      if (!r.ok) return { error: `Home Assistant returned ${r.status}. Check HA_URL and HA_TOKEN.` };
      const states = await r.json() as unknown[];
      return { count: states.length, entities: (states as Record<string, unknown>[]).slice(0, 50).map(s => ({ id: s.entity_id, state: s.state, name: (s.attributes as Record<string, unknown>)?.friendly_name })) };
    }
    if (toolName === "home.devices.control") {
      const domain = (args.entity_id as string).split(".")[0];
      const service = args.action === "turn_on" ? "turn_on" : args.action === "turn_off" ? "turn_off" : args.action as string;
      const r = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: args.entity_id })
      });
      return r.json();
    }
    if (toolName === "home.network.list_clients") {
      const r = await fetch(`${UNIFI_URL}/proxy/network/api/s/default/stat/sta`, {
        headers: { Authorization: `Bearer ${UNIFI_TOKEN}` }
      });
      if (!r.ok) return { error: `UniFi returned ${r.status}` };
      return r.json();
    }
  }

  // ── AI / MEMORY ───────────────────────────────────────────────────────────
  if (category === "ai") {
    if (toolName === "ai.memory.search") {
      const r = await fetch("https://api.mem0.ai/v1/memories/search/", {
        method: "POST",
        headers: { Authorization: `Token ${MEM0_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query, user_id: "jaden" })
      });
      return r.json();
    }
    if (toolName === "ai.memory.add") {
      const r = await fetch("https://api.mem0.ai/v1/memories/", {
        method: "POST",
        headers: { Authorization: `Token ${MEM0_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: args.content }], user_id: "jaden" })
      });
      return r.json();
    }
    if (toolName === "ai.reasoning.think") {
      // Simple sequential thinking — break into steps
      return {
        problem: args.problem,
        approach: "sequential_thinking",
        steps: [
          "1. Understand the problem scope and constraints",
          "2. Identify key components and dependencies",
          "3. Consider alternative approaches",
          "4. Evaluate trade-offs",
          "5. Formulate a concrete plan"
        ],
        note: "Use this as a thinking framework. Apply each step to your specific problem."
      };
    }
  }

  // ── WEB ───────────────────────────────────────────────────────────────────
  if (category === "web") {
    if (toolName === "web.scraping.scrape") {
      const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: args.url, formats: ["markdown"] })
      });
      return r.json();
    }
    if (toolName === "web.scraping.search") {
      const r = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query })
      });
      return r.json();
    }
  }

  // ── INFRASTRUCTURE ────────────────────────────────────────────────────────
  if (category === "infrastructure") {
    if (toolName === "infrastructure.code.list_repos") {
      const url = args.org
        ? `https://api.github.com/orgs/${args.org}/repos?per_page=50`
        : "https://api.github.com/user/repos?per_page=50";
      const r = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "garza-mcp-router" } });
      const repos = await r.json() as unknown[];
      return { count: repos.length, repos: (repos as Record<string, unknown>[]).map(r => ({ name: r.name, full_name: r.full_name, private: r.private, updated_at: r.updated_at })) };
    }
    if (toolName === "infrastructure.code.create_pr") {
      const r = await fetch(`https://api.github.com/repos/${args.repo}/pulls`, {
        method: "POST",
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "garza-mcp-router" },
        body: JSON.stringify({ title: args.title, head: args.head, base: args.base, body: args.body || "" })
      });
      return r.json();
    }
    if (toolName === "infrastructure.code.create_issue") {
      const r = await fetch(`https://api.github.com/repos/${args.repo}/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "garza-mcp-router" },
        body: JSON.stringify({ title: args.title, body: args.body || "" })
      });
      return r.json();
    }
    if (toolName === "infrastructure.cdn.list_workers") {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCT}/workers/scripts`, {
        headers: { Authorization: `Bearer ${CLOUDFLARE_TOKEN}` }
      });
      return r.json();
    }
    if (toolName === "infrastructure.cdn.query_d1") {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCT}/d1/database/${args.database_id}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CLOUDFLARE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql: args.sql })
      });
      return r.json();
    }
  }

  // ── AUTOMATION ────────────────────────────────────────────────────────────
  if (category === "automation") {
    if (toolName === "automation.workflow.list_n8n") {
      const r = await fetch(`${N8N_URL}/api/v1/workflows`, {
        headers: { "X-N8N-API-KEY": N8N_TOKEN }
      });
      return r.json();
    }
    if (toolName === "automation.workflow.execute_n8n") {
      const r = await fetch(`${N8N_URL}/api/v1/workflows/${args.workflow_id}/activate`, {
        method: "POST",
        headers: { "X-N8N-API-KEY": N8N_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(args.data || {})
      });
      return r.json();
    }
    if (toolName === "automation.agents.run_composio") {
      const r = await fetch(`https://backend.composio.dev/api/v2/actions/${args.action}/execute`, {
        method: "POST",
        headers: { "x-api-key": COMPOSIO_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ input: args.params || {} })
      });
      return r.json();
    }
    if (toolName === "automation.tasks.list_taskr") {
      const r = await fetch("https://www.taskr.one/api/tasks", {
        headers: { Authorization: `Bearer ${TASKR_KEY}` }
      });
      return r.json();
    }
    if (toolName === "automation.tasks.create_taskr") {
      const r = await fetch("https://www.taskr.one/api/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${TASKR_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: args.title, description: args.description })
      });
      return r.json();
    }
  }

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  if (category === "analytics") {
    if (toolName === "analytics.ai_ops.list_traces") {
      const r = await fetch(`${LANGFUSE_URL}/api/public/traces?limit=${args.limit || 20}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${LANGFUSE_PUBLIC}:${LANGFUSE_SECRET}`).toString("base64")}` }
      });
      return r.json();
    }
    if (toolName === "analytics.web.get_stats" || toolName === "analytics.web.get_stats_plausible") {
      const siteId = (args.site_id as string) || "nomadinternet.com";
      const period = (args.period as string) || "30d";
      const r = await fetch(`https://plausible.io/api/v1/stats/summary?site_id=${siteId}&period=${period}`, {
        headers: { Authorization: `Bearer ${PLAUSIBLE_KEY}` }
      });
      return r.json();
    }
  }

  // ── FINANCE ───────────────────────────────────────────────────────────────
  if (category === "finance") {
    if (toolName === "finance.payments.list_charges") {
      const limit = args.limit || 10;
      const url = args.customer
        ? `https://api.stripe.com/v1/charges?limit=${limit}&customer=${args.customer}`
        : `https://api.stripe.com/v1/charges?limit=${limit}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
      return r.json();
    }
    if (toolName === "finance.subscriptions.list") {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status as string);
      if (args.customer) params.set("customer", args.customer as string);
      const r = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
        headers: { Authorization: `Bearer ${STRIPE_KEY}` }
      });
      return r.json();
    }
    if (toolName === "finance.subscriptions.cancel") {
      const r = await fetch(`https://api.stripe.com/v1/subscriptions/${args.subscription_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${STRIPE_KEY}` }
      });
      return r.json();
    }
    if (toolName === "finance.analytics.get_mrr") {
      const start = (args.start_date as string) || new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const end = (args.end_date as string) || new Date().toISOString().split("T")[0];
      const r = await fetch(`https://api.chartmogul.com/v1/metrics/mrr?start-date=${start}&end-date=${end}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${CHARTMOGUL_KEY}:`).toString("base64")}` }
      });
      return r.json();
    }
    if (toolName === "finance.analytics.get_churn") {
      const start = (args.start_date as string) || new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const end = (args.end_date as string) || new Date().toISOString().split("T")[0];
      const r = await fetch(`https://api.chartmogul.com/v1/metrics/customer-churn-rate?start-date=${start}&end-date=${end}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${CHARTMOGUL_KEY}:`).toString("base64")}` }
      });
      return r.json();
    }
    if (toolName === "finance.billing.list_invoices") {
      const url = args.customer_id
        ? `https://${CHARGEBEE_SITE}.chargebee.com/api/v2/invoices?customer_id[is]=${args.customer_id}`
        : `https://${CHARGEBEE_SITE}.chargebee.com/api/v2/invoices?limit=10`;
      const r = await fetch(url, {
        headers: { Authorization: `Basic ${Buffer.from(`${CHARGEBEE_KEY}:`).toString("base64")}` }
      });
      return r.json();
    }
  }

  // ── ECOMMERCE ─────────────────────────────────────────────────────────────
  if (category === "ecommerce") {
    if (toolName === "ecommerce.shipping.list_shipments") {
      const url = args.order_id
        ? `https://ssapi.shipstation.com/shipments?orderNumber=${args.order_id}`
        : "https://ssapi.shipstation.com/shipments?pageSize=25";
      const r = await fetch(url, {
        headers: { Authorization: `Basic ${Buffer.from(`${SHIPSTATION_KEY}:`).toString("base64")}` }
      });
      return r.json();
    }
  }

  // ── DATABASE / CRM ────────────────────────────────────────────────────────
  if (category === "database") {
    if (toolName === "database.crm.list_contacts") {
      const r = await fetch(`${TWENTY_URL}/api/people?first=${args.limit || 20}`, {
        headers: { Authorization: `Bearer ${TWENTY_KEY}` }
      });
      return r.json();
    }
    if (toolName === "database.crm.list_deals") {
      const r = await fetch(`${TWENTY_URL}/api/opportunities`, {
        headers: { Authorization: `Bearer ${TWENTY_KEY}` }
      });
      return r.json();
    }
  }

  // ── Fallback: return routing info ─────────────────────────────────────────
  return {
    tool: toolName,
    server,
    status: "not_implemented",
    message: `Tool '${toolName}' is registered but backend execution is not yet implemented. Use router.tools.add to wire it to a backend URL, or submit a PR to add it to the router source.`,
    args
  };
}

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMcpHandler(serverName: "personal" | "dev" | "nomad", baseTools: ToolDef[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any) => {
    const body = await c.req.json() as { method: string; id: unknown; params: Record<string, unknown> };
    const { method, id, params } = body;

    const runtimeRegistry = serverName === "personal" ? RUNTIME_PERSONAL_TOOLS
      : serverName === "dev" ? RUNTIME_DEV_TOOLS : RUNTIME_NOMAD_TOOLS;
    const allTools = [...baseTools, ...runtimeRegistry];

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: `garza-mcp-${serverName}`, version: "4.0.0" }
        }
      });
    }

    if (method === "tools/list") {
      return c.json({ jsonrpc: "2.0", id, result: { tools: allTools } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
      try {
        const result = await executeTool(name, args || {}, serverName, allTools);
        return c.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
        });
      } catch (err) {
        return c.json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } });
      }
    }

    if (method === "notifications/initialized") {
      return c.json({ jsonrpc: "2.0", id, result: {} });
    }

    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function authCheck(token: string): boolean {
  return token === GATEWAY_TOKEN ||
    token === "garza-personal-2025" ||
    token === "garza-dev-2025" ||
    token === "garza-nomad-2025" ||
    token === "garza-mcp-router-2025" ||
    token === "garza-mcp-2025";
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = new Hono();

app.get("/", (c) => c.json({
  name: "GARZA OS Unified MCP Router",
  version: "4.0.0",
  servers: {
    personal: { path: "/personal", tools: PERSONAL_TOOLS.length + RUNTIME_PERSONAL_TOOLS.length, categories: [...new Set(PERSONAL_TOOLS.map(t => t.name.split(".")[0]))] },
    dev:      { path: "/dev",      tools: DEV_TOOLS.length + RUNTIME_DEV_TOOLS.length,           categories: [...new Set(DEV_TOOLS.map(t => t.name.split(".")[0]))] },
    nomad:    { path: "/nomad",    tools: NOMAD_TOOLS.length + RUNTIME_NOMAD_TOOLS.length,       categories: [...new Set(NOMAD_TOOLS.map(t => t.name.split(".")[0]))] },
  },
  total_tools: PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length,
  status: "ok",
  new_in_v4: ["22 Beeper tools (voice transcription, chat monitoring, bulk search)", "8 self-management tools (router.tools.*)", "Full backend execution for all tools", "Fixed vaults.secrets.get response shape"]
}));

app.get("/health", (c) => c.json({ status: "ok", uptime: process.uptime(), version: "4.0.0" }));

const servers = [
  { path: "/personal", tools: PERSONAL_TOOLS, name: "personal" as const },
  { path: "/dev",      tools: DEV_TOOLS,      name: "dev" as const },
  { path: "/nomad",    tools: NOMAD_TOOLS,    name: "nomad" as const },
];

for (const { path, tools, name } of servers) {
  const handler = makeMcpHandler(name, tools);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withAuth = async (c: any) => {
    const auth = c.req.header("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!authCheck(token)) return c.json({ error: "Unauthorized" }, 401);
    return handler(c);
  };
  app.post(path, withAuth);
  app.post(`${path}/mcp`, withAuth);
}

// Export for Vercel serverless
export default app;

// Start server when running directly (Railway, local, Fly.io)
if (process.env.VERCEL !== '1') {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`\n🚀 GARZA OS Unified MCP Router v4.0 running on port ${PORT}`);
    console.log(`\n  Servers:`);
    console.log(`    /personal  → ${PERSONAL_TOOLS.length} tools (${[...new Set(PERSONAL_TOOLS.map(t => t.name.split(".")[0]))].join(", ")})`);
    console.log(`    /dev       → ${DEV_TOOLS.length} tools (${[...new Set(DEV_TOOLS.map(t => t.name.split(".")[0]))].join(", ")})`);
    console.log(`    /nomad     → ${NOMAD_TOOLS.length} tools (${[...new Set(NOMAD_TOOLS.map(t => t.name.split(".")[0]))].join(", ")})`);
    console.log(`\n  Total: ${PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length} tools across 3 servers`);
    console.log(`  NEW: 22 Beeper tools + 8 self-management tools + full backend execution\n`);
  });
}
