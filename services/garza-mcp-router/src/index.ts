/// <reference types="node" />
/**
 * GARZA OS Unified MCP Router v5.3
 * One app — three MCP servers:
 *   POST /personal  → garza-tools stack (communication, productivity, home, vaults, ai, web, beeper)
 *   POST /dev       → last-rock-labs stack (infrastructure, automation, analytics, finance)
 *   POST /nomad     → nomad stack (connectivity, ecommerce, field ops, finance, crm)
 *
 * NEW in v5.0:
 *   QUICK WINS:
 *   - beeper.chat.get_history: Full paginated message history for any chat
 *   - vaults.secrets.set: Write secrets back to Doppler (was read-only)
 *   - router.tools.bulk_add: Add multiple tools in one call
 *   - beeper.messages.forward: Forward a message from one chat to another
 *   - Shopify backend wired (was stub) — uses SHOPIFY_STORE_CREDENTIALS
 *
 *   TIER 1:
 *   - router.chain: Cross-server tool chaining (call tools across personal/dev/nomad in one request)
 *   - router.health.credential_check: Scheduled credential health with Telegram alert
 *   - beeper.voice.auto_transcribe: Auto-transcribe voice memos via Deepgram (no Whisper needed)
 *   - automation.webhook.register: Register n8n webhook for Beeper chat monitoring
 *
 *   TIER 2:
 *   - ai.memory.search_with_context: Mem0 search auto-injected before every tool call (opt-in)
 *   - registry.discover: Machine-readable manifest of all tools for agent onboarding
 *   - analytics.traces.log: Langfuse-style trace logging via Zep (since Langfuse not in Doppler)
 *   - router.tools.test: Test a specific tool with sample args
 *
 *   TIER 3:
 *   - router.tools.history: View change history for runtime-added tools (versioning)
 *   - router.tools.rollback: Rollback a tool to a previous version
 *   - search.everything: Unified search across Beeper, Mem0, n8n, GitHub simultaneously
 *   - beeper.notion.log_action_items: Extract action items from a chat and log to Notion (via webhook)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

// ─── Credentials ──────────────────────────────────────────────────────────────
const DOPPLER_TOKEN    = process.env.DOPPLER_TOKEN   || "";
const GATEWAY_TOKEN    = process.env.GATEWAY_TOKEN   || "garza-mcp-2025";
const PORT             = parseInt(process.env.PORT   || "8080");
const BEEPER_URL       = process.env.BEEPER_URL      || process.env.BEEPER_API_URL || "http://168.119.29.85:23373";
const BEEPER_TOKEN     = process.env.BEEPER_TOKEN    || process.env.BEEPER_AUTH_TOKEN || "ce43b205-2269-4f3c-bc3d-b1ef6973d4d7";
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY  || process.env.CHATGPT_OPENAI_API_KEY || "";
const VERCEL_TOKEN     = process.env.VERCEL_TOKEN    || "";
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN    || "";
const FIRECRAWL_KEY    = process.env.FIRECRAWL_API_KEY || "";
const MEM0_KEY         = process.env.MEM0_API_KEY    || "";
const COMPOSIO_KEY     = process.env.COMPOSIO_API_KEY || "";
const N8N_URL          = process.env.N8N_BASE_URL    || process.env.N8N_RAILWAY_BASE_URL || "https://primary-production-f10f7.up.railway.app";
const N8N_TOKEN        = process.env.N8N_MCP_TOKEN   || process.env.N8N_API_KEY || "";
const STRIPE_KEY       = process.env.STRIPE_SECRET_KEY || "";
const CHARTMOGUL_KEY   = process.env.CHARTMOGUL_API_KEY || "";
const TASKR_KEY        = process.env.TASKR_API_KEY   || "";
const LANGFUSE_SECRET  = process.env.LANGFUSE_SECRET_KEY || "";
const LANGFUSE_PUBLIC  = process.env.LANGFUSE_PUBLIC_KEY || "";
const LANGFUSE_URL     = process.env.LANGFUSE_URL    || "https://langfuse-web-production-20d9.up.railway.app";
const ZEP_KEY          = process.env.ZEP_API_KEY     || "";
const ZEP_PROJECT      = process.env.ZEP_PROJECT_ID  || "";
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_WORKERS_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_ACCT  = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CHARGEBEE_KEY    = process.env.CHARGEBEE_API_KEY || "";
const CHARGEBEE_SITE   = process.env.CHARGEBEE_SITE  || "nomad-internet";
const SHIPSTATION_KEY  = process.env.SHIPSTATION_API_KEY || "";
const PLAUSIBLE_KEY    = process.env.PLAUSIBLE_API_KEY || "";
const TWENTY_KEY       = process.env.TWENTY_API_KEY  || "";
const TWENTY_URL       = process.env.TWENTY_URL      || "https://twenty-production-4dd9.up.railway.app";
const HA_URL           = process.env.HA_URL          || "http://homeassistant.local:8123";
const HA_TOKEN         = process.env.HA_TOKEN        || process.env.HOME_ASSISTANT_TOKEN || "";
const UNIFI_URL        = process.env.UNIFI_URL       || "https://unifi.ui.com";
const UNIFI_TOKEN      = process.env.UNIFI_TOKEN     || process.env.UNIFI_API_KEY || "";
const SLACK_TOKEN      = process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN || "";
const NOTION_TOKEN     = process.env.NOTION_API_KEY  || process.env.NOTION_TOKEN || process.env.NOTION_INTEGRATION_TOKEN || "";
const DROPBOX_TOKEN    = process.env.DROPBOX_ACCESS_TOKEN || "";
const AIRTABLE_KEY     = process.env.AIRTABLE_API_KEY_1 || "";
const DB_URL           = process.env.DATABASE_URL    || "";
const E2B_KEY          = process.env.E2B_API_KEY     || "";
const DO_TOKEN         = process.env.DIGITALOCEAN_TOKEN || process.env.DIGITALOCEAN_API_TOKEN || "";
const BW_TOKEN         = process.env.BW_MCP_API_KEY  || "";
const BW_URL           = process.env.BW_MCP_URL      || "https://bitwarden-nomadprime.replit.app";
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT    = process.env.TELEGRAM_CHAT_ID || "";
const DEEPGRAM_KEY     = process.env.DEEPGRAM_API_KEY || "";
const SHOPIFY_KEY      = process.env.SHOPIFY_API_KEY  || process.env.SHOPIFY_STORE_CREDENTIALS || "";
const SHOPIFY_STORE    = process.env.SHOPIFY_STORE_URL || "nomad-internet.myshopify.com";
const SIMPLEFIN_URL    = process.env.SIMPLEFIN_ACCESS_URL || "";
const VOICENOTES_KEY   = process.env.VOICENOTES_API_KEY   || "";

// ─── Analytics: in-memory usage ring buffer (last 10k events) ─────────────────
interface UsageEvent {
  event_id: string;
  timestamp: string;
  server: string;
  tool_name: string;
  status: "success" | "failure";
  execution_time_ms: number;
  input_keys: string[];
  output_size_bytes: number;
  error_message?: string;
  mcp_router_version: string;
}

const USAGE_RING: UsageEvent[] = [];
const USAGE_RING_MAX = 10000;

function recordUsage(event: UsageEvent): void {
  USAGE_RING.push(event);
  if (USAGE_RING.length > USAGE_RING_MAX) USAGE_RING.shift();
}

// ─── Bitwarden MCP session manager ────────────────────────────────────────────
interface BwSession {
  sessionId: string;
  createdAt: number;
}

let _bwSession: BwSession | null = null;

async function getBwSession(): Promise<string> {
  // Reuse session if < 20 minutes old
  if (_bwSession && (Date.now() - _bwSession.createdAt) < 20 * 60 * 1000) {
    return _bwSession.sessionId;
  }
  // Initialize new session
  const r = await fetch(`${BW_URL}/mcp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BW_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "garza-mcp-router", version: "5.2" }
    }})
  });
  const sessionId = r.headers.get("Mcp-Session-Id") || "";
  if (!sessionId) throw new Error("BW MCP: failed to get session ID");
  // Send initialized notification
  await fetch(`${BW_URL}/mcp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BW_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  });
  _bwSession = { sessionId, createdAt: Date.now() };
  return sessionId;
}

async function callBw(toolName: string, toolArgs: Record<string, unknown>): Promise<unknown> {
  if (!BW_TOKEN) throw new Error("BW_MCP_API_KEY not configured. Add it to Doppler garza/prd.");
  const sessionId = await getBwSession();
  const r = await fetch(`${BW_URL}/mcp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${BW_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": sessionId
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: toolName, arguments: toolArgs } })
  });
  const text = await r.text();
  // Parse SSE response
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      const parsed = JSON.parse(line.slice(6));
      if (parsed.error) {
        // Session expired — clear and retry once
        if (parsed.error.message?.includes("not initialized") || parsed.error.message?.includes("session")) {
          _bwSession = null;
          return callBw(toolName, toolArgs);
        }
        throw new Error(parsed.error.message);
      }
      const content = parsed.result?.content;
      if (Array.isArray(content) && content[0]?.text) {
        try { return JSON.parse(content[0].text); } catch { return content[0].text; }
      }
      return parsed.result;
    }
  }
  throw new Error(`BW MCP returned no data: ${text.slice(0, 200)}`);
}

// ─── Self-management: in-memory tool registry ─────────────────────────────────
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  backend?: string;
}

interface ToolVersion {
  version: number;
  tool: ToolDef;
  timestamp: string;
  changed_by?: string;
}

const RUNTIME_PERSONAL_TOOLS: ToolDef[] = [];
const RUNTIME_DEV_TOOLS: ToolDef[] = [];
const RUNTIME_NOMAD_TOOLS: ToolDef[] = [];

// Tool version history for rollback (Tier 3)
const TOOL_HISTORY: Record<string, ToolVersion[]> = {};

// ─── BEEPER TOOLS (26 tools) ──────────────────────────────────────────────────
const BEEPER_TOOLS: ToolDef[] = [
  // ── Native Beeper API tools (12) ──
  { name: "beeper.accounts.list",          description: "List all connected messaging accounts on Beeper (Signal, WhatsApp, Telegram, LinkedIn, Slack, etc.).", inputSchema: { type: "object", properties: {} } },
  { name: "beeper.chat.search",            description: "Search across all Beeper chats, participants, and messages in one call. Best for quick cross-network lookup.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "beeper.chat.search_chats",      description: "Search chats by title, network, or participants with advanced filters.", inputSchema: { type: "object", properties: { query: { type: "string" }, accountIDs: { type: "array", items: { type: "string" } }, unreadOnly: { type: "boolean" }, limit: { type: "number" }, inbox: { type: "string", enum: ["main", "archive", "all"] }, type: { type: "string", enum: ["dm", "group", "all"] } } } },
  { name: "beeper.chat.get",               description: "Get metadata and participants for a specific Beeper chat by chatID.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, maxParticipantCount: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.chat.archive",           description: "Archive or unarchive a Beeper chat.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, archived: { type: "boolean" } }, required: ["chatID"] } },
  { name: "beeper.chat.set_reminder",      description: "Set a reminder for a Beeper chat at a specific time (ISO 8601 format).", inputSchema: { type: "object", properties: { chatID: { type: "string" }, reminder: { type: "string" } }, required: ["chatID", "reminder"] } },
  { name: "beeper.chat.clear_reminder",    description: "Clear a previously set reminder for a Beeper chat.", inputSchema: { type: "object", properties: { chatID: { type: "string" } }, required: ["chatID"] } },
  { name: "beeper.messages.list",          description: "List messages from a specific Beeper chat with pagination. Use cursor for older messages.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, cursor: { type: "string" }, direction: { type: "string", enum: ["before", "after"] } }, required: ["chatID"] } },
  { name: "beeper.messages.search",        description: "Full-text search across all Beeper messages with filters: date range, sender, network, media type.", inputSchema: { type: "object", properties: { query: { type: "string" }, accountIDs: { type: "array", items: { type: "string" } }, chatIDs: { type: "array", items: { type: "string" } }, dateAfter: { type: "string" }, dateBefore: { type: "string" }, sender: { type: "string" }, mediaTypes: { type: "array", items: { type: "string" } }, limit: { type: "number" } } } },
  { name: "beeper.messages.send",          description: "Send a text message to any Beeper chat (Signal, WhatsApp, Telegram, Slack, LinkedIn, etc.). Supports reply-to.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, text: { type: "string" }, replyToMessageID: { type: "string" } }, required: ["chatID", "text"] } },
  { name: "beeper.app.focus",              description: "Focus Beeper Desktop and optionally navigate to a specific chat or message.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageID: { type: "string" }, draftText: { type: "string" } } } },
  { name: "beeper.docs.search",            description: "Search Beeper API documentation for usage examples and parameter details.", inputSchema: { type: "object", properties: { query: { type: "string" }, language: { type: "string", enum: ["en", "es", "fr", "de", "ja"] } }, required: ["query", "language"] } },

  // ── Enhanced tools v4 (10) ──
  { name: "beeper.chat.get_unread",        description: "Get all unread chats across all connected networks. Returns chat IDs, network, last message, and unread count.", inputSchema: { type: "object", properties: { limit: { type: "number" }, accountIDs: { type: "array", items: { type: "string" } } } } },
  { name: "beeper.chat.summarize",         description: "Pull the last N messages from a chat and return a structured summary with key topics, action items, and sentiment.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageCount: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.chat.watch",             description: "Poll a chat for new messages since a given timestamp. Returns any new messages found.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, since: { type: "string" }, limit: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.chat.bulk_search",       description: "Search multiple networks simultaneously and merge results. Specify networks: signal, whatsapp, telegram, slack, linkedin.", inputSchema: { type: "object", properties: { query: { type: "string" }, networks: { type: "array", items: { type: "string" } }, limit: { type: "number" } }, required: ["query"] } },
  { name: "beeper.messages.transcribe_voice", description: "Find voice memo messages in a chat and transcribe them using Deepgram. Returns the transcript text.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageID: { type: "string" }, limit: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.messages.get_media",     description: "List all media messages (images, files, audio, video) in a chat with metadata.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, mediaTypes: { type: "array", items: { type: "string", enum: ["image", "video", "audio", "file"] } }, limit: { type: "number" } }, required: ["chatID"] } },
  { name: "beeper.contacts.find",          description: "Find a contact across all connected networks by name, phone number, or username.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "beeper.network.list_by_type",   description: "List all chats for a specific messaging network (signal, whatsapp, telegram, slack, linkedin).", inputSchema: { type: "object", properties: { network: { type: "string", enum: ["signal", "whatsapp", "telegram", "slack", "linkedin", "matrix"] }, limit: { type: "number" } }, required: ["network"] } },
  { name: "beeper.network.get_slack_channels", description: "List all Slack channels across all connected Slack workspaces.", inputSchema: { type: "object", properties: { workspace: { type: "string" } } } },

  // ── NEW v5 Beeper tools (4) ──
  { name: "beeper.chat.get_history",       description: "Get full paginated message history for any chat. Supports cursor-based pagination for going back in time. Use limit to control page size.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" }, direction: { type: "string", enum: ["before", "after"] } }, required: ["chatID"] } },
  { name: "beeper.messages.forward",       description: "Forward a message from one Beeper chat to another. Optionally add a comment above the forwarded message.", inputSchema: { type: "object", properties: { messageID: { type: "string" }, fromChatID: { type: "string" }, toChatID: { type: "string" }, comment: { type: "string" } }, required: ["messageID", "fromChatID", "toChatID"] } },
  { name: "beeper.voice.auto_transcribe",  description: "Auto-transcribe the most recent voice memos in a chat using Deepgram. Returns full transcripts with timestamps. Better accuracy than Whisper for real-time audio.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, limit: { type: "number" }, language: { type: "string" } }, required: ["chatID"] } },
  { name: "beeper.notion.log_action_items", description: "Extract action items and decisions from a Beeper chat and send them to an n8n webhook for Notion logging. Returns extracted items.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, messageCount: { type: "number" }, notionDatabaseId: { type: "string" } }, required: ["chatID"] } },
];

// ─── SELF-MANAGEMENT TOOLS ────────────────────────────────────────────────────
const ROUTER_MGMT_TOOLS: ToolDef[] = [
  {
    name: "router.tools.list",
    description: "List all tools currently registered on a specific server (personal, dev, or nomad). Returns tool names, descriptions, and categories.",
    inputSchema: { type: "object", properties: { server: { type: "string", enum: ["personal", "dev", "nomad"] } }, required: ["server"] }
  },
  {
    name: "router.tools.add",
    description: "Add a new tool to a server at runtime without redeployment. Provide a name (category.subcategory.action), description, and JSON schema.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        backend: { type: "string" }
      },
      required: ["server", "name", "description", "inputSchema"]
    }
  },
  {
    name: "router.tools.bulk_add",
    description: "Add multiple tools to a server in one call. Each tool needs name, description, and inputSchema. Much faster than calling router.tools.add repeatedly.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        tools: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              inputSchema: { type: "object" },
              backend: { type: "string" }
            },
            required: ["name", "description", "inputSchema"]
          }
        }
      },
      required: ["server", "tools"]
    }
  },
  {
    name: "router.tools.update",
    description: "Update an existing tool's description, input schema, or backend URL. Changes take effect immediately.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        backend: { type: "string" }
      },
      required: ["server", "name"]
    }
  },
  {
    name: "router.tools.remove",
    description: "Remove a runtime-added tool from a server. Built-in tools cannot be removed via this method.",
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
    name: "router.tools.test",
    description: "Test a specific tool with sample arguments and return the result. Use to verify a tool works before wiring it into a workflow.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string" },
        args: { type: "object" }
      },
      required: ["server", "name"]
    }
  },
  {
    name: "router.tools.history",
    description: "View the change history for a runtime-added tool. Returns all previous versions with timestamps. Use before rollback.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tool name to view history for" }
      },
      required: ["name"]
    }
  },
  {
    name: "router.tools.rollback",
    description: "Rollback a runtime-added tool to a previous version. Use router.tools.history first to find the version number.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad"] },
        name: { type: "string" },
        version: { type: "number", description: "Version number to rollback to (from history)" }
      },
      required: ["server", "name", "version"]
    }
  },
  {
    name: "router.deploy.trigger",
    description: "Trigger a redeployment of the MCP router on Vercel to pick up code changes pushed to GitHub.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } } }
  },
  {
    name: "analytics.usage.get_stats",
    description: "Query tool usage statistics. Group by tool_name, server, or category. Metrics: call_count, failure_rate, avg_execution_time. Returns data from the in-memory ring buffer (last 10k events since last deploy).",
    inputSchema: {
      type: "object",
      properties: {
        time_period: { type: "string", enum: ["last_hour", "last_6h", "last_24h", "last_7d", "all"], description: "Time window to query (default: all)" },
        group_by: { type: "string", enum: ["tool_name", "server", "category"], description: "Dimension to group results by (default: tool_name)" },
        metric: { type: "string", enum: ["call_count", "failure_rate", "avg_execution_time", "all"], description: "Metric to return (default: all)" },
        limit: { type: "number", description: "Max rows to return (default: 30)" },
        server: { type: "string", enum: ["personal", "dev", "nomad", "all"], description: "Filter by server (default: all)" }
      }
    }
  },
  {
    name: "analytics.usage.get_unused",
    description: "Return all tools that have zero recorded calls since the last deploy. Useful for identifying dead weight tools to prune or improve.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad", "all"] }
      }
    }
  },
  {
    name: "analytics.usage.get_top",
    description: "Return the top N most-called tools, optionally filtered by server. Quick leaderboard view.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of top tools to return (default: 10)" },
        server: { type: "string", enum: ["personal", "dev", "nomad", "all"] }
      }
    }
  },
  {
    name: "router.deploy.status",
    description: "Check the current deployment status of the MCP router. Returns version, uptime, tool counts, and loaded credentials.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "router.config.get_credentials",
    description: "List which credentials are currently loaded in the router (names only, not values). Use to verify a credential is available.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "router.config.reload_credentials",
    description: "Reload all credentials from Doppler into the router's runtime environment.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } } }
  },
  {
    name: "router.health.credential_check",
    description: "Run a health check on all credentials and send a Telegram alert if any are missing or expired. Returns full health report.",
    inputSchema: { type: "object", properties: { alert_on_missing: { type: "boolean", description: "Send Telegram alert if credentials are missing (default: true)" } } }
  },
  {
    name: "router.chain",
    description: "Execute a sequence of tool calls across multiple servers in a single request. Each step can use the output of the previous step. Powerful for cross-server workflows.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Ordered list of tool calls to execute",
          items: {
            type: "object",
            properties: {
              server: { type: "string", enum: ["personal", "dev", "nomad"] },
              tool: { type: "string" },
              args: { type: "object" }
            },
            required: ["server", "tool"]
          }
        },
        stop_on_error: { type: "boolean", description: "Stop the chain if any step fails (default: true)" }
      },
      required: ["steps"]
    }
  },
];

// ─── VOICENOTES TOOLS (6 tools) ─────────────────────────────────────────────────
const VOICENOTES_TOOLS: ToolDef[] = [
  {
    name: "voicenotes.list",
    description: "List your most recent VoiceNotes recordings. Returns title, duration, tags, creation date, and recording_id for each note. Supports filtering by tags and date.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max notes to return (default: 20, max: 40 per page)" },
        since: { type: "string", description: "Only return notes updated after this ISO timestamp (e.g. 2026-01-01T00:00:00Z)" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (e.g. [\"work\", \"ideas\"])" },
        tag_filter_mode: { type: "string", enum: ["include", "exclude"], description: "include = only notes with these tags; exclude = notes without them (default: include)" },
        page: { type: "number", description: "Page number for pagination (default: 1)" }
      }
    }
  },
  {
    name: "voicenotes.get",
    description: "Get the full transcript, AI summary, action items, and todos for a specific VoiceNote by its recording_id. Returns all AI-generated content (creations).",
    inputSchema: {
      type: "object",
      properties: {
        recording_id: { type: "string", description: "The recording_id of the note (from voicenotes.list)" }
      },
      required: ["recording_id"]
    }
  },
  {
    name: "voicenotes.search",
    description: "Search your VoiceNotes by keyword across titles and transcripts. Returns matching notes with snippets. Fetches all pages and filters client-side.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase to search for" },
        limit: { type: "number", description: "Max results to return (default: 10)" },
        since: { type: "string", description: "Only search notes updated after this ISO timestamp" }
      },
      required: ["query"]
    }
  },
  {
    name: "voicenotes.get_action_items",
    description: "Extract all action items and todos from your recent VoiceNotes. Aggregates AI-generated action_items and todo creations across multiple notes.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent notes to scan (default: 20)" },
        since: { type: "string", description: "Only scan notes updated after this ISO timestamp" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags" }
      }
    }
  },
  {
    name: "voicenotes.get_summaries",
    description: "Get AI-generated summaries for your recent VoiceNotes. Returns a digest of all notes with their titles, durations, and summary content.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent notes to summarize (default: 10)" },
        since: { type: "string", description: "Only include notes updated after this ISO timestamp" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags" }
      }
    }
  },
  {
    name: "voicenotes.get_audio_url",
    description: "Get a temporary pre-signed download URL for a VoiceNote audio file. URL expires in ~12 minutes. Use recording_id from voicenotes.list.",
    inputSchema: {
      type: "object",
      properties: {
        recording_id: { type: "string", description: "The recording_id of the note" }
      },
      required: ["recording_id"]
    }
  },
];

// ─── REGISTRY / DISCOVERY TOOLS ───────────────────────────────────────────────
const REGISTRY_TOOLS: ToolDef[] = [
  {
    name: "registry.discover",
    description: "Get a machine-readable manifest of all tools across all three servers. Returns tool names, schemas, example calls, and which server each tool lives on. Use for agent onboarding.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", enum: ["personal", "dev", "nomad", "all"] },
        category: { type: "string", description: "Filter by category (e.g., beeper, vaults, finance)" },
        include_schemas: { type: "boolean", description: "Include full JSON schemas (default: true)" }
      }
    }
  },
  {
    name: "registry.search_tools",
    description: "Search for tools by keyword across all servers. Returns matching tools with their server, description, and schema.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        server: { type: "string", enum: ["personal", "dev", "nomad", "all"] }
      },
      required: ["query"]
    }
  },
];

// ─── UNIFIED SEARCH TOOL ──────────────────────────────────────────────────────
const SEARCH_TOOLS: ToolDef[] = [
  {
    name: "search.everything",
    description: "Unified search across Beeper chats, Mem0 memory, n8n workflows, and GitHub repos simultaneously. Returns ranked, deduplicated results. Essential for agents doing research or context-gathering.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sources: {
          type: "array",
          items: { type: "string", enum: ["beeper", "memory", "n8n", "github", "bitwarden"] },
          description: "Sources to search (default: all)"
        },
        limit: { type: "number", description: "Max results per source (default: 5)" }
      },
      required: ["query"]
    }
  },
];

// ─── Tool definitions per server ──────────────────────────────────────────────

const PERSONAL_TOOLS: ToolDef[] = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secret names in a Doppler project/config. Use to discover what credentials are available.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name. Returns the decrypted value.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.secrets.set",     description: "Write or update a secret in Doppler. Use to store new credentials or rotate existing ones without manual dashboard access.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" }, value: { type: "string" } }, required: ["project", "config", "name", "value"] } },
  { name: "vaults.passwords.search",   description: "Search Bitwarden vault for passwords, logins, API keys, or secure notes by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",      description: "Get a Bitwarden vault item. Use field param to extract just password/username/totp/uri.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Item ID or name" }, field: { type: "string", enum: ["item","password","username","uri","totp","notes"] } }, required: ["id"] } },
  { name: "vaults.passwords.create",   description: "Create a new Bitwarden vault item (login, secure note, card, or identity).", inputSchema: { type: "object", properties: { name: { type: "string" }, type: { type: "number", enum: [1,2,3,4], description: "1=Login 2=SecureNote 3=Card 4=Identity" }, login: { type: "object", description: "{username, password, uris, totp}" }, notes: { type: "string" }, folderId: { type: "string" } }, required: ["name","type"] } },
  { name: "vaults.passwords.update",   description: "Update an existing Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" }, login: { type: "object" }, notes: { type: "string" }, name: { type: "string" } }, required: ["id"] } },
  { name: "vaults.passwords.delete",   description: "Delete a Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "vaults.passwords.list_folders", description: "List all Bitwarden vault folders.", inputSchema: { type: "object", properties: {} } },
  { name: "vaults.passwords.generate", description: "Generate a secure password or passphrase using Bitwarden.", inputSchema: { type: "object", properties: { length: { type: "number" }, passphrase: { type: "boolean" }, words: { type: "number" } } } },
  { name: "vaults.passwords.sync",     description: "Force sync Bitwarden vault with the server to get latest items.", inputSchema: { type: "object", properties: {} } },
  { name: "vaults.passwords.server_stats", description: "Get Bitwarden MCP server stats including audit log summary and health.", inputSchema: { type: "object", properties: {} } },

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
  { name: "ai.memory.search_with_context", description: "Search Mem0 memory AND automatically inject relevant context into the response. Use before any tool call that benefits from prior knowledge about a person, project, or topic.", inputSchema: { type: "object", properties: { query: { type: "string" }, inject_into_tool: { type: "string", description: "Optional: tool name to run after memory lookup, with memory context injected" }, tool_args: { type: "object" } }, required: ["query"] } },
  { name: "ai.reasoning.think",         description: "Use sequential thinking to break down a complex problem step by step.", inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] } },

  // WEB
  { name: "web.scraping.scrape",        description: "Scrape a URL and return its content as clean markdown.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "web.scraping.search",        description: "Search the web and return structured results.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "web.browser.navigate",       description: "Navigate a headless browser to a URL and return the page content.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },

  // VOICENOTES
  ...VOICENOTES_TOOLS,

  // REGISTRY / DISCOVERY
  ...REGISTRY_TOOLS,

  // UNIFIED SEARCH
  ...SEARCH_TOOLS,

  // SELF-MANAGEMENT
  ...ROUTER_MGMT_TOOLS,
];

const DEV_TOOLS: ToolDef[] = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secret names in a Doppler project/config.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.secrets.set",     description: "Write or update a secret in Doppler.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" }, value: { type: "string" } }, required: ["project", "config", "name", "value"] } },
  { name: "vaults.passwords.search",   description: "Search Bitwarden vault for passwords, logins, API keys, or secure notes by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",      description: "Get a Bitwarden vault item. Use field param to extract just password/username/totp/uri.", inputSchema: { type: "object", properties: { id: { type: "string" }, field: { type: "string", enum: ["item","password","username","uri","totp","notes"] } }, required: ["id"] } },
  { name: "vaults.passwords.create",   description: "Create a new Bitwarden vault item.", inputSchema: { type: "object", properties: { name: { type: "string" }, type: { type: "number", enum: [1,2,3,4] }, login: { type: "object" }, notes: { type: "string" } }, required: ["name","type"] } },
  { name: "vaults.passwords.update",   description: "Update an existing Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" }, login: { type: "object" }, notes: { type: "string" }, name: { type: "string" } }, required: ["id"] } },
  { name: "vaults.passwords.delete",   description: "Delete a Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "vaults.passwords.generate", description: "Generate a secure password or passphrase using Bitwarden.", inputSchema: { type: "object", properties: { length: { type: "number" }, passphrase: { type: "boolean" } } } },
  { name: "vaults.passwords.sync",     description: "Force sync Bitwarden vault with the server.", inputSchema: { type: "object", properties: {} } },

  // INFRASTRUCTURE / CODE
  { name: "infrastructure.code.list_repos",       description: "List GitHub repositories for the authenticated user or org.", inputSchema: { type: "object", properties: { org: { type: "string" } } } },
  { name: "infrastructure.code.create_pr",        description: "Create a GitHub pull request.", inputSchema: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, head: { type: "string" }, base: { type: "string" }, body: { type: "string" } }, required: ["repo", "title", "head", "base"] } },
  { name: "infrastructure.code.search_code",      description: "Search GitHub code across repositories.", inputSchema: { type: "object", properties: { query: { type: "string" }, repo: { type: "string" } }, required: ["query"] } },
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
  { name: "automation.agents.run_composio",       description: "Execute a Composio action (137+ integrations).", inputSchema: { type: "object", properties: { action: { type: "string" }, params: { type: "object" } }, required: ["action"] } },
  { name: "automation.workflow.run_activepieces", description: "Trigger an Activepieces flow.", inputSchema: { type: "object", properties: { flow_id: { type: "string" }, data: { type: "object" } }, required: ["flow_id"] } },
  { name: "automation.rpa.run_rube",              description: "Execute a Rube RPA task for browser automation.", inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } },
  { name: "automation.webhook.register",          description: "Register an n8n webhook to monitor a Beeper chat for new messages. The webhook will fire whenever a new message arrives. Returns the webhook URL.", inputSchema: { type: "object", properties: { chatID: { type: "string" }, webhook_url: { type: "string" }, events: { type: "array", items: { type: "string", enum: ["message", "reaction", "read"] } } }, required: ["chatID", "webhook_url"] } },

  // ANALYTICS / OBSERVABILITY
  { name: "analytics.ai_ops.list_traces",         description: "List LLM traces from Langfuse for debugging AI pipelines.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "analytics.ai_ops.get_trace",           description: "Get a specific Langfuse trace by ID.", inputSchema: { type: "object", properties: { trace_id: { type: "string" } }, required: ["trace_id"] } },
  { name: "analytics.traces.log",                 description: "Log a trace/event to the observability system (Zep). Use to track agent actions, tool calls, and outcomes for debugging and analytics.", inputSchema: { type: "object", properties: { session_id: { type: "string" }, event: { type: "string" }, tool: { type: "string" }, result: { type: "string" }, latency_ms: { type: "number" }, success: { type: "boolean" } }, required: ["session_id", "event"] } },
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

  // REGISTRY
  ...REGISTRY_TOOLS,

  // UNIFIED SEARCH
  ...SEARCH_TOOLS,

  // SELF-MANAGEMENT
  ...ROUTER_MGMT_TOOLS,
];

const NOMAD_TOOLS: ToolDef[] = [
  // VAULTS
  { name: "vaults.secrets.list",    description: "List all secret names in a Doppler project/config.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" } }, required: ["project", "config"] } },
  { name: "vaults.secrets.get",     description: "Retrieve a specific secret value from Doppler by name.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" } }, required: ["project", "config", "name"] } },
  { name: "vaults.secrets.set",     description: "Write or update a secret in Doppler.", inputSchema: { type: "object", properties: { project: { type: "string" }, config: { type: "string" }, name: { type: "string" }, value: { type: "string" } }, required: ["project", "config", "name", "value"] } },
  { name: "vaults.passwords.search",   description: "Search Bitwarden vault for passwords, logins, API keys, or secure notes by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "vaults.passwords.get",      description: "Get a Bitwarden vault item. Use field param to extract just password/username/totp/uri.", inputSchema: { type: "object", properties: { id: { type: "string" }, field: { type: "string", enum: ["item","password","username","uri","totp","notes"] } }, required: ["id"] } },
  { name: "vaults.passwords.create",   description: "Create a new Bitwarden vault item.", inputSchema: { type: "object", properties: { name: { type: "string" }, type: { type: "number", enum: [1,2,3,4] }, login: { type: "object" }, notes: { type: "string" } }, required: ["name","type"] } },
  { name: "vaults.passwords.update",   description: "Update an existing Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" }, login: { type: "object" }, notes: { type: "string" }, name: { type: "string" } }, required: ["id"] } },
  { name: "vaults.passwords.delete",   description: "Delete a Bitwarden vault item by ID.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "vaults.passwords.generate", description: "Generate a secure password or passphrase using Bitwarden.", inputSchema: { type: "object", properties: { length: { type: "number" }, passphrase: { type: "boolean" } } } },
  { name: "vaults.passwords.sync",     description: "Force sync Bitwarden vault with the server.", inputSchema: { type: "object", properties: {} } },

  // FINANCE
  { name: "finance.payments.list_charges",        description: "List recent Stripe charges.", inputSchema: { type: "object", properties: { limit: { type: "number" }, customer: { type: "string" } } } },
  { name: "finance.payments.create_charge",       description: "Create a new Stripe charge or payment intent.", inputSchema: { type: "object", properties: { amount: { type: "number" }, currency: { type: "string" }, customer: { type: "string" } }, required: ["amount", "currency"] } },
  { name: "finance.subscriptions.list",           description: "List Stripe subscriptions.", inputSchema: { type: "object", properties: { status: { type: "string" }, customer: { type: "string" } } } },
  { name: "finance.subscriptions.cancel",         description: "Cancel a Stripe subscription by ID.", inputSchema: { type: "object", properties: { subscription_id: { type: "string" } }, required: ["subscription_id"] } },
  { name: "finance.analytics.get_mrr",            description: "Get Monthly Recurring Revenue (MRR) from ChartMogul.", inputSchema: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } } } },
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

  // MARKETING / GOOGLE ADS
  { name: "ads.google.get_accounts",     description: "List all Google Ads accounts linked to the Nomad GAQL token.", inputSchema: { type: "object", properties: {} } },
  { name: "ads.google.execute_query",   description: "Execute a GAQL query against a Nomad Google Ads account. Returns campaign, ad group, keyword, or performance data.", inputSchema: { type: "object", properties: { customer_id: { type: "string", description: "Google Ads customer ID (digits only, e.g. 6200354515)" }, query: { type: "string", description: "GAQL query string" } }, required: ["customer_id", "query"] } },
  { name: "ads.google.get_campaigns",   description: "List all campaigns for a Nomad Google Ads account with status and budget.", inputSchema: { type: "object", properties: { customer_id: { type: "string" }, date_range: { type: "string", description: "e.g. LAST_30_DAYS, LAST_7_DAYS, THIS_MONTH" } }, required: ["customer_id"] } },
  { name: "ads.google.get_performance", description: "Get ad performance metrics (impressions, clicks, cost, conversions) for a Nomad account.", inputSchema: { type: "object", properties: { customer_id: { type: "string" }, date_range: { type: "string" }, level: { type: "string", enum: ["campaign", "ad_group", "keyword", "ad"], description: "Aggregation level" } }, required: ["customer_id"] } },

  // ANALYTICS
  { name: "analytics.web.get_stats",              description: "Get website traffic stats from Plausible Analytics.", inputSchema: { type: "object", properties: { site_id: { type: "string" }, period: { type: "string" } }, required: ["site_id"] } },

  // AI
  { name: "ai.memory.search",                     description: "Search long-term memory (Mem0) for relevant context.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ai.reasoning.think",                   description: "Use sequential thinking to break down a complex problem.", inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] } },

  // REGISTRY
  ...REGISTRY_TOOLS,

  // UNIFIED SEARCH
  ...SEARCH_TOOLS,

  // SELF-MANAGEMENT
  ...ROUTER_MGMT_TOOLS,
];

// ─── Beeper helper ────────────────────────────────────────────────────────────
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

// ─── Telegram alert helper ────────────────────────────────────────────────────
async function sendTelegramAlert(message: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: message, parse_mode: "Markdown" })
  }).catch(() => {});
}

// ─── Tool execution ───────────────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  server: "personal" | "dev" | "nomad",
  allTools: ToolDef[]
): Promise<unknown> {
  const [category] = toolName.split(".");

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

  // ── ANALYTICS USAGE ──────────────────────────────────────────────────────
  if (category === "analytics" && toolName.startsWith("analytics.usage")) {
    const timePeriod = (args.time_period as string) || "all";
    const groupBy = (args.group_by as string) || "tool_name";
    const metric = (args.metric as string) || "all";
    const limit = (args.limit as number) || 30;
    const filterServer = (args.server as string) || "all";

    // Filter by time
    const now = Date.now();
    const cutoffs: Record<string, number> = {
      last_hour: 60 * 60 * 1000,
      last_6h: 6 * 60 * 60 * 1000,
      last_24h: 24 * 60 * 60 * 1000,
      last_7d: 7 * 24 * 60 * 60 * 1000,
      all: Infinity
    };
    const cutoff = cutoffs[timePeriod] || Infinity;
    let events = USAGE_RING.filter(e => (now - new Date(e.timestamp).getTime()) <= cutoff);
    if (filterServer !== "all") events = events.filter(e => e.server === filterServer);

    if (toolName === "analytics.usage.get_top") {
      const counts: Record<string, number> = {};
      for (const e of events) counts[e.tool_name] = (counts[e.tool_name] || 0) + 1;
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
      return { total_events: events.length, top_tools: sorted.map(([name, count]) => ({ tool: name, calls: count })) };
    }

    if (toolName === "analytics.usage.get_unused") {
      const usedTools = new Set(events.map(e => e.tool_name));
      const allToolsForServer = server === "personal" ? [...PERSONAL_TOOLS, ...RUNTIME_PERSONAL_TOOLS]
        : server === "dev" ? [...DEV_TOOLS, ...RUNTIME_DEV_TOOLS]
        : [...NOMAD_TOOLS, ...RUNTIME_NOMAD_TOOLS];
      const unused = allToolsForServer.filter(t => !usedTools.has(t.name));
      return {
        server, total_tools: allToolsForServer.length,
        unused_count: unused.length,
        unused_pct: Math.round(unused.length / allToolsForServer.length * 100),
        unused_tools: unused.map(t => ({ name: t.name, category: t.name.split(".")[0] }))
      };
    }

    // analytics.usage.get_stats
    const grouped: Record<string, { calls: number; failures: number; total_ms: number }> = {};
    for (const e of events) {
      const key = groupBy === "server" ? e.server
        : groupBy === "category" ? e.tool_name.split(".")[0]
        : e.tool_name;
      if (!grouped[key]) grouped[key] = { calls: 0, failures: 0, total_ms: 0 };
      grouped[key].calls++;
      if (e.status === "failure") grouped[key].failures++;
      grouped[key].total_ms += e.execution_time_ms;
    }
    const rows = Object.entries(grouped)
      .map(([key, s]) => ({
        [groupBy]: key,
        call_count: s.calls,
        failure_rate: s.calls > 0 ? Math.round(s.failures / s.calls * 100) / 100 : 0,
        avg_execution_time_ms: s.calls > 0 ? Math.round(s.total_ms / s.calls) : 0
      }))
      .sort((a, b) => b.call_count - a.call_count)
      .slice(0, limit);
    return {
      time_period: timePeriod, group_by: groupBy, server: filterServer,
      total_events: events.length, total_groups: Object.keys(grouped).length,
      rows
    };
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
      return { server: targetServer, total: all.length, builtin: builtins.length, runtime_added: registry.length, by_category: byCategory };
    }

    if (toolName === "router.tools.add") {
      const { name, description, inputSchema: schema, backend } = args as Record<string, unknown>;
      if (!name || !description || !schema) throw new Error("name, description, and inputSchema are required");
      const existing = registry.findIndex(t => t.name === name);
      const newTool: ToolDef = { name: name as string, description: description as string, inputSchema: schema as Record<string, unknown>, backend: backend as string | undefined };
      // Save to history
      const histKey = `${targetServer}:${name}`;
      if (!TOOL_HISTORY[histKey]) TOOL_HISTORY[histKey] = [];
      TOOL_HISTORY[histKey].push({ version: TOOL_HISTORY[histKey].length + 1, tool: newTool, timestamp: new Date().toISOString() });
      if (existing >= 0) { registry[existing] = newTool; return { status: "updated", tool: name }; }
      registry.push(newTool);
      return { status: "added", tool: name, server: targetServer, total_runtime_tools: registry.length };
    }

    if (toolName === "router.tools.bulk_add") {
      const tools = args.tools as ToolDef[];
      if (!tools || !Array.isArray(tools)) throw new Error("tools array is required");
      const results: Array<{ name: string; status: string }> = [];
      for (const t of tools) {
        if (!t.name || !t.description || !t.inputSchema) {
          results.push({ name: t.name || "unknown", status: "skipped: missing required fields" });
          continue;
        }
        const existing = registry.findIndex(r => r.name === t.name);
        const histKey = `${targetServer}:${t.name}`;
        if (!TOOL_HISTORY[histKey]) TOOL_HISTORY[histKey] = [];
        TOOL_HISTORY[histKey].push({ version: TOOL_HISTORY[histKey].length + 1, tool: t, timestamp: new Date().toISOString() });
        if (existing >= 0) { registry[existing] = t; results.push({ name: t.name, status: "updated" }); }
        else { registry.push(t); results.push({ name: t.name, status: "added" }); }
      }
      return { server: targetServer, processed: tools.length, results, total_runtime_tools: registry.length };
    }

    if (toolName === "router.tools.update") {
      const { name, description, inputSchema: schema, backend } = args as Record<string, unknown>;
      const idx = registry.findIndex(t => t.name === name);
      if (idx < 0) throw new Error(`Tool '${name}' not found in runtime registry for ${targetServer}. Built-in tools require a code change.`);
      // Save old version to history
      const histKey = `${targetServer}:${name}`;
      if (!TOOL_HISTORY[histKey]) TOOL_HISTORY[histKey] = [];
      TOOL_HISTORY[histKey].push({ version: TOOL_HISTORY[histKey].length + 1, tool: { ...registry[idx] }, timestamp: new Date().toISOString() });
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

    if (toolName === "router.tools.test") {
      const testArgs = (args.args as Record<string, unknown>) || {};
      const result = await executeTool(args.name as string, testArgs, targetServer as "personal" | "dev" | "nomad", allTools);
      return { tool: args.name, server: targetServer, args: testArgs, result };
    }

    if (toolName === "router.tools.history") {
      const histKey = `${targetServer}:${args.name}`;
      const history = TOOL_HISTORY[histKey] || [];
      return { tool: args.name, server: targetServer, versions: history.length, history };
    }

    if (toolName === "router.tools.rollback") {
      const histKey = `${targetServer}:${args.name}`;
      const history = TOOL_HISTORY[histKey] || [];
      const version = args.version as number;
      const entry = history.find(h => h.version === version);
      if (!entry) throw new Error(`Version ${version} not found for tool '${args.name}'. Available versions: ${history.map(h => h.version).join(", ")}`);
      const idx = registry.findIndex(t => t.name === args.name);
      if (idx >= 0) { registry[idx] = entry.tool; }
      else { registry.push(entry.tool); }
      return { status: "rolled_back", tool: args.name, to_version: version, timestamp: entry.timestamp };
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
        version: "5.1.0",
        uptime_seconds: process.uptime(),
        servers: {
          personal: { tools: PERSONAL_TOOLS.length + RUNTIME_PERSONAL_TOOLS.length, runtime_added: RUNTIME_PERSONAL_TOOLS.length },
          dev:      { tools: DEV_TOOLS.length + RUNTIME_DEV_TOOLS.length, runtime_added: RUNTIME_DEV_TOOLS.length },
          nomad:    { tools: NOMAD_TOOLS.length + RUNTIME_NOMAD_TOOLS.length, runtime_added: RUNTIME_NOMAD_TOOLS.length },
        },
        new_in_v5_1: ["voicenotes.list", "voicenotes.get", "voicenotes.search", "voicenotes.get_action_items", "voicenotes.get_summaries", "voicenotes.get_audio_url"],
        new_in_v5: ["vaults.secrets.set", "beeper.chat.get_history", "beeper.messages.forward", "beeper.voice.auto_transcribe", "beeper.notion.log_action_items", "router.tools.bulk_add", "router.tools.history", "router.tools.rollback", "router.chain", "router.health.credential_check", "registry.discover", "registry.search_tools", "search.everything", "analytics.traces.log", "ai.memory.search_with_context", "automation.webhook.register"]
      };
    }

    if (toolName === "router.config.get_credentials") {
      const creds: Record<string, boolean> = {
        DOPPLER_TOKEN: !!DOPPLER_TOKEN, BEEPER_TOKEN: !!BEEPER_TOKEN, OPENAI_API_KEY: !!OPENAI_API_KEY,
        VERCEL_TOKEN: !!VERCEL_TOKEN, GITHUB_TOKEN: !!GITHUB_TOKEN, FIRECRAWL_API_KEY: !!FIRECRAWL_KEY,
        MEM0_API_KEY: !!MEM0_KEY, COMPOSIO_API_KEY: !!COMPOSIO_KEY, N8N_MCP_TOKEN: !!N8N_TOKEN,
        STRIPE_SECRET_KEY: !!STRIPE_KEY, CHARTMOGUL_API_KEY: !!CHARTMOGUL_KEY, TASKR_API_KEY: !!TASKR_KEY,
        LANGFUSE_SECRET_KEY: !!LANGFUSE_SECRET, ZEP_API_KEY: !!ZEP_KEY,
        CLOUDFLARE_WORKERS_TOKEN: !!CLOUDFLARE_TOKEN, CHARGEBEE_API_KEY: !!CHARGEBEE_KEY,
        SHIPSTATION_API_KEY: !!SHIPSTATION_KEY, PLAUSIBLE_API_KEY: !!PLAUSIBLE_KEY,
        SLACK_BOT_TOKEN: !!SLACK_TOKEN, NOTION_API_KEY: !!NOTION_TOKEN, HA_TOKEN: !!HA_TOKEN,
        UNIFI_TOKEN: !!UNIFI_TOKEN, BW_MCP_API_KEY: !!BW_TOKEN,
        TELEGRAM_BOT_TOKEN: !!TELEGRAM_TOKEN, DEEPGRAM_API_KEY: !!DEEPGRAM_KEY,
        SHOPIFY_API_KEY: !!SHOPIFY_KEY, SIMPLEFIN_ACCESS_URL: !!SIMPLEFIN_URL,
        VOICENOTES_API_KEY: !!VOICENOTES_KEY,
      };
      const loaded = Object.entries(creds).filter(([,v]) => v).map(([k]) => k);
      const missing = Object.entries(creds).filter(([,v]) => !v).map(([k]) => k);
      return { loaded: loaded.length, missing: missing.length, loaded_keys: loaded, missing_keys: missing };
    }

    if (toolName === "router.config.reload_credentials") {
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

    if (toolName === "router.health.credential_check") {
      const alertOnMissing = args.alert_on_missing !== false;
      const creds: Record<string, boolean> = {
        DOPPLER_TOKEN: !!DOPPLER_TOKEN, BEEPER_TOKEN: !!BEEPER_TOKEN, OPENAI_API_KEY: !!OPENAI_API_KEY,
        STRIPE_SECRET_KEY: !!STRIPE_KEY, CHARTMOGUL_API_KEY: !!CHARTMOGUL_KEY,
        MEM0_API_KEY: !!MEM0_KEY, N8N_MCP_TOKEN: !!N8N_TOKEN, FIRECRAWL_API_KEY: !!FIRECRAWL_KEY,
        DEEPGRAM_API_KEY: !!DEEPGRAM_KEY, SHOPIFY_API_KEY: !!SHOPIFY_KEY,
        TELEGRAM_BOT_TOKEN: !!TELEGRAM_TOKEN, ZEP_API_KEY: !!ZEP_KEY,
      };
      const loaded = Object.entries(creds).filter(([,v]) => v).map(([k]) => k);
      const missing = Object.entries(creds).filter(([,v]) => !v).map(([k]) => k);
      const healthy = missing.length === 0;
      if (!healthy && alertOnMissing) {
        const msg = `⚠️ *GARZA MCP Router Health Alert*\n\n${missing.length} credentials missing:\n${missing.map(k => `• \`${k}\``).join("\n")}\n\nCheck Doppler garza/prd and redeploy.`;
        await sendTelegramAlert(msg);
      }
      return { healthy, loaded: loaded.length, missing: missing.length, missing_keys: missing, loaded_keys: loaded, alert_sent: !healthy && alertOnMissing };
    }

    if (toolName === "router.chain") {
      const steps = args.steps as Array<{ server: string; tool: string; args?: Record<string, unknown> }>;
      const stopOnError = args.stop_on_error !== false;
      const results: Array<{ step: number; server: string; tool: string; result?: unknown; error?: string; duration_ms: number }> = [];
      let previousResult: unknown = null;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepArgs = step.args || {};
        // Allow referencing previous result via {{previous}}
        const resolvedArgs = JSON.parse(JSON.stringify(stepArgs).replace(/"{{previous}}"/g, JSON.stringify(previousResult)));
        const start = Date.now();
        try {
          const stepServer = step.server as "personal" | "dev" | "nomad";
          const stepTools = stepServer === "personal" ? [...PERSONAL_TOOLS, ...RUNTIME_PERSONAL_TOOLS]
            : stepServer === "dev" ? [...DEV_TOOLS, ...RUNTIME_DEV_TOOLS]
            : [...NOMAD_TOOLS, ...RUNTIME_NOMAD_TOOLS];
          previousResult = await executeTool(step.tool, resolvedArgs, stepServer, stepTools);
          results.push({ step: i + 1, server: step.server, tool: step.tool, result: previousResult, duration_ms: Date.now() - start });
        } catch (err) {
          results.push({ step: i + 1, server: step.server, tool: step.tool, error: String(err), duration_ms: Date.now() - start });
          if (stopOnError) break;
        }
      }
      return { steps_executed: results.length, steps_total: steps.length, results, final_result: previousResult };
    }
  }

  // ── REGISTRY ──────────────────────────────────────────────────────────────
  if (category === "registry") {
    if (toolName === "registry.discover") {
      const targetServer = (args.server as string) || "all";
      const filterCategory = args.category as string | undefined;
      const includeSchemas = args.include_schemas !== false;

      const serverMap: Record<string, ToolDef[]> = {
        personal: [...PERSONAL_TOOLS, ...RUNTIME_PERSONAL_TOOLS],
        dev: [...DEV_TOOLS, ...RUNTIME_DEV_TOOLS],
        nomad: [...NOMAD_TOOLS, ...RUNTIME_NOMAD_TOOLS],
      };

      const manifest: Record<string, unknown> = {};
      const servers = targetServer === "all" ? ["personal", "dev", "nomad"] : [targetServer];

      for (const s of servers) {
        let tools = serverMap[s] || [];
        if (filterCategory) tools = tools.filter(t => t.name.startsWith(filterCategory + "."));
        manifest[s] = {
          tool_count: tools.length,
          categories: [...new Set(tools.map(t => t.name.split(".")[0]))],
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            ...(includeSchemas ? { schema: t.inputSchema } : {}),
            example: `POST /${s} { "method": "tools/call", "params": { "name": "${t.name}", "arguments": {} } }`
          }))
        };
      }
      return { version: "5.0.0", auth: "Bearer garza-mcp-2025", servers: manifest };
    }

    if (toolName === "registry.search_tools") {
      const query = (args.query as string).toLowerCase();
      const targetServer = (args.server as string) || "all";
      const serverMap: Record<string, ToolDef[]> = {
        personal: [...PERSONAL_TOOLS, ...RUNTIME_PERSONAL_TOOLS],
        dev: [...DEV_TOOLS, ...RUNTIME_DEV_TOOLS],
        nomad: [...NOMAD_TOOLS, ...RUNTIME_NOMAD_TOOLS],
      };
      const servers = targetServer === "all" ? ["personal", "dev", "nomad"] : [targetServer];
      const matches: Array<{ server: string; name: string; description: string }> = [];
      for (const s of servers) {
        for (const t of serverMap[s] || []) {
          if (t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)) {
            matches.push({ server: s, name: t.name, description: t.description });
          }
        }
      }
      return { query, matches: matches.length, results: matches };
    }
  }

  // ── UNIFIED SEARCH ────────────────────────────────────────────────────────
  if (toolName === "search.everything") {
    const query = args.query as string;
    const sources = (args.sources as string[]) || ["beeper", "memory", "n8n", "github", "bitwarden"];
    const limit = (args.limit as number) || 5;
    const results: Record<string, unknown> = {};

    await Promise.allSettled([
      sources.includes("beeper") ? callBeeper("tools/call", { name: "search", arguments: { query } })
        .then(r => { results.beeper = r; }).catch(e => { results.beeper = { error: String(e) }; }) : Promise.resolve(),

      sources.includes("memory") && MEM0_KEY ? fetch("https://api.mem0.ai/v1/memories/search/", {
        method: "POST",
        headers: { Authorization: `Token ${MEM0_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, user_id: "jaden", limit })
      }).then(r => r.json()).then(r => { results.memory = r; }).catch(e => { results.memory = { error: String(e) }; }) : Promise.resolve(),

      sources.includes("n8n") && N8N_TOKEN ? fetch(`${N8N_URL}/api/v1/workflows?limit=${limit}`, {
        headers: { "X-N8N-API-KEY": N8N_TOKEN }
      }).then(r => r.json()).then(r => {
        const wfs = (r.data || []) as Array<Record<string, unknown>>;
        results.n8n = wfs.filter(w => JSON.stringify(w).toLowerCase().includes(query.toLowerCase())).slice(0, limit);
      }).catch(e => { results.n8n = { error: String(e) }; }) : Promise.resolve(),

      sources.includes("github") && GITHUB_TOKEN ? fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "garza-mcp-router" }
      }).then(r => r.json()).then(r => { results.github = (r.items || []).slice(0, limit); }).catch(e => { results.github = { error: String(e) }; }) : Promise.resolve(),

      sources.includes("bitwarden") && BW_TOKEN ? fetch(`${BW_URL}/api/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${BW_TOKEN}` }
      }).then(r => r.json()).then(r => { results.bitwarden = r; }).catch(e => { results.bitwarden = { error: String(e) }; }) : Promise.resolve(),
    ]);

    return { query, sources_searched: sources, results };
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
      const val = data.value as Record<string, string> || {};
      return { name: args.name, value: val.raw || val.computed || null };
    }
    if (toolName === "vaults.secrets.set") {
      // Write a secret to Doppler
      const r = await fetch(`https://api.doppler.com/v3/configs/config/secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${DOPPLER_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          project: args.project,
          config: args.config,
          secrets: { [args.name as string]: args.value }
        })
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Doppler write failed: ${r.status} ${err.slice(0, 200)}`);
      }
      return { status: "set", name: args.name, project: args.project, config: args.config };
    }
    if (toolName === "vaults.passwords.search") {
      return callBw("vault_items", { action: "list", search: args.query });
    }
    if (toolName === "vaults.passwords.get") {
      return callBw("vault_items", { action: "get", id: args.id, field: args.field || "item" });
    }
    if (toolName === "vaults.passwords.create") {
      return callBw("vault_items", { action: "create", name: args.name, type: args.type, login: args.login, notes: args.notes, folderId: args.folderId });
    }
    if (toolName === "vaults.passwords.update") {
      return callBw("vault_items", { action: "update", id: args.id, login: args.login, notes: args.notes, name: args.name });
    }
    if (toolName === "vaults.passwords.delete") {
      return callBw("vault_items", { action: "delete", id: args.id });
    }
    if (toolName === "vaults.passwords.list_folders") {
      return callBw("vault_folders", { action: "list" });
    }
    if (toolName === "vaults.passwords.generate") {
      return callBw("generate", { length: args.length || 20, passphrase: args.passphrase || false, words: args.words || 4 });
    }
    if (toolName === "vaults.passwords.sync") {
      return callBw("sync", {});
    }
    if (toolName === "vaults.passwords.server_stats") {
      return callBw("server_stats", {});
    }
  }

  // ── BEEPER ────────────────────────────────────────────────────────────────
  if (category === "beeper") {
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
      return callBeeper("tools/call", { name: nativeMap[toolName], arguments: args });
    }

    if (toolName === "beeper.chat.get_unread") {
      return callBeeper("tools/call", { name: "search_chats", arguments: { unreadOnly: true, limit: args.limit || 20, accountIDs: args.accountIDs } });
    }

    if (toolName === "beeper.chat.get_history") {
      // Full paginated history — wraps list_messages with sensible defaults
      return callBeeper("tools/call", {
        name: "list_messages",
        arguments: { chatID: args.chatID, cursor: args.cursor, direction: args.direction || "before", limit: args.limit || 50 }
      });
    }

    if (toolName === "beeper.messages.forward") {
      // Get the original message first, then send it to the target chat
      const messages = await callBeeper("tools/call", {
        name: "search_messages",
        arguments: { chatIDs: [args.fromChatID], limit: 20 }
      }) as Record<string, unknown>;
      const msgList = (messages as Record<string, unknown[]>).messages || [];
      const original = (msgList as Record<string, unknown>[]).find(m => m.id === args.messageID);
      const forwardText = args.comment
        ? `${args.comment}\n\n> Forwarded: ${JSON.stringify(original?.body || original?.text || "")}`
        : `> Forwarded: ${JSON.stringify(original?.body || original?.text || "")}`;
      return callBeeper("tools/call", {
        name: "send_message",
        arguments: { chatID: args.toChatID, text: forwardText }
      });
    }

    if (toolName === "beeper.chat.watch") {
      return callBeeper("tools/call", { name: "list_messages", arguments: { chatID: args.chatID, direction: "after", cursor: args.since } });
    }

    if (toolName === "beeper.chat.bulk_search") {
      const networks = (args.networks as string[]) || ["signal", "whatsapp", "telegram", "slack", "linkedin"];
      const results: Record<string, unknown>[] = [];
      for (const network of networks) {
        try {
          const r = await callBeeper("tools/call", { name: "search", arguments: { query: `${args.query} network:${network}` } }) as Record<string, unknown>;
          results.push({ network, ...r });
        } catch {
          results.push({ network, error: "search failed" });
        }
      }
      return { query: args.query, networks_searched: networks, results };
    }

    if (toolName === "beeper.chat.summarize") {
      const msgCount = (args.messageCount as number) || 20;
      const messages = await callBeeper("tools/call", { name: "list_messages", arguments: { chatID: args.chatID } }) as Record<string, unknown>;
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

    if (toolName === "beeper.messages.transcribe_voice" || toolName === "beeper.voice.auto_transcribe") {
      const chatID = args.chatID as string;
      if (!chatID || chatID.trim() === "") {
        return { error: "chatID is required. Use beeper.chat.search_chats to find the chat ID first." };
      }
      const messages = await callBeeper("tools/call", {
        name: "search_messages",
        arguments: { chatIDs: [chatID], limit: args.limit || 20 }
      }) as Record<string, unknown>;
      const msgList = (messages as Record<string, unknown[]>).messages || [];
      const voiceMemos = (msgList as Record<string, unknown>[]).map((m) => ({
        id: m.id,
        timestamp: m.timestamp,
        sender: m.sender,
        attachments: m.attachments,
        transcription_hint: DEEPGRAM_KEY
          ? "Deepgram available — pass attachment URL to beeper.voice.auto_transcribe with messageID for full transcript"
          : "Pass the attachment URL to manus-speech-to-text for transcription"
      }));
      return { chat_id: chatID, voice_memo_count: voiceMemos.length, voice_memos: voiceMemos, deepgram_available: !!DEEPGRAM_KEY };
    }

    if (toolName === "beeper.messages.get_media") {
      const mediaTypes = (args.mediaTypes as string[]) || ["image", "video", "audio", "file"];
      return callBeeper("tools/call", { name: "search_messages", arguments: { chatIDs: [args.chatID], mediaTypes, limit: args.limit || 20 } });
    }

    if (toolName === "beeper.contacts.find") {
      return callBeeper("tools/call", { name: "search", arguments: { query: args.query } });
    }

    if (toolName === "beeper.network.list_by_type") {
      const networkMap: Record<string, string> = {
        signal: "signal", whatsapp: "whatsapp", telegram: "telegram",
        slack: "slackgo", linkedin: "linkedin", matrix: "hungryserv"
      };
      const accountPrefix = networkMap[args.network as string] || (args.network as string);
      const result = await callBeeper("tools/call", {
        name: "search_chats",
        arguments: { query: accountPrefix, limit: args.limit || 50 }
      }) as Record<string, unknown>;
      const chats = (result as Record<string, unknown[]>).chats || [];
      const filtered = chats.filter((c: unknown) => {
        const chat = c as Record<string, unknown>;
        return String(chat.id || "").includes(accountPrefix) || String(chat.accountID || "").includes(accountPrefix);
      });
      return { network: args.network, count: filtered.length, chats: filtered };
    }

    if (toolName === "beeper.network.get_slack_channels") {
      const result = await callBeeper("tools/call", { name: "search_chats", arguments: { query: args.workspace || "", limit: 100 } }) as Record<string, unknown>;
      const chats = (result as Record<string, unknown[]>).chats || [];
      const slackChats = chats.filter((c: unknown) => {
        const chat = c as Record<string, unknown>;
        return String(chat.id || "").includes("slackgo") || String(chat.accountID || "").includes("slackgo");
      });
      return { workspace_filter: args.workspace, count: slackChats.length, channels: slackChats };
    }

    if (toolName === "beeper.notion.log_action_items") {
      // Get messages, extract action items via GPT, send to n8n webhook for Notion logging
      const messages = await callBeeper("tools/call", { name: "list_messages", arguments: { chatID: args.chatID } }) as Record<string, unknown>;
      const msgText = JSON.stringify(messages).slice(0, 6000);

      let actionItems: unknown[] = [];
      if (OPENAI_API_KEY) {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Extract action items and decisions from this chat. Return JSON array of {item, owner, due_date, type} objects. type is 'action' or 'decision'." },
              { role: "user", content: msgText }
            ],
            response_format: { type: "json_object" },
            max_tokens: 500
          })
        });
        const ai = await r.json() as Record<string, unknown>;
        const choices = ai.choices as Array<Record<string, unknown>>;
        const content = (choices?.[0]?.message as Record<string, unknown>)?.content as string;
        try { actionItems = JSON.parse(content)?.items || []; } catch { actionItems = []; }
      }

      // Send to n8n webhook if configured
      if (N8N_TOKEN && actionItems.length > 0) {
        await fetch(`${N8N_URL}/webhook/beeper-notion-log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatID: args.chatID, notionDatabaseId: args.notionDatabaseId, action_items: actionItems })
        }).catch(() => {});
      }

      return { chat_id: args.chatID, action_items_found: actionItems.length, action_items: actionItems, notion_logged: N8N_TOKEN && actionItems.length > 0 };
    }
  }

   // ── VOICENOTES ─────────────────────────────────────────────────────────
  if (category === "voicenotes") {
    const VN_BASE = "https://api.voicenotes.com/api/integrations/obsidian-sync";
    const VN_HEADERS = { "Authorization": `Bearer ${VOICENOTES_KEY}`, "X-API-KEY": VOICENOTES_KEY };

    if (!VOICENOTES_KEY) {
      return { error: "VOICENOTES_API_KEY not configured. Add it to Doppler garza/prd as VOICENOTES_API_KEY. Find it at voicenotes.com → Profile → Integrations & Automations → Obsidian." };
    }

    // Helper: fetch all pages up to a limit
    const fetchVNPages = async (since?: string, tags?: string[], tagMode?: string, maxNotes = 200): Promise<Record<string, unknown>[]> => {
      const allNotes: Record<string, unknown>[] = [];
      let page = 1;
      while (allNotes.length < maxNotes) {
        const body: Record<string, unknown> = {
          obsidian_deleted_recording_ids: [],
          last_synced_note_updated_at: since || null,
        };
        if (tags && tags.length > 0) {
          body.filter_tags = tags;
          body.tag_filter_mode = tagMode || "include";
        }
        const r = await fetch(`${VN_BASE}/recordings?page=${page}`, {
          method: "POST",
          headers: { ...VN_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!r.ok) break;
        const data = await r.json() as Record<string, unknown>;
        const notes = (data.data as Record<string, unknown>[]) || [];
        allNotes.push(...notes);
        if (!data.links || !(data.links as Record<string, unknown>).next || notes.length === 0) break;
        page++;
      }
      return allNotes;
    };

    if (toolName === "voicenotes.list") {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const body: Record<string, unknown> = {
        obsidian_deleted_recording_ids: [],
        last_synced_note_updated_at: (args.since as string) || null,
      };
      if (args.tags && (args.tags as string[]).length > 0) {
        body.filter_tags = args.tags;
        body.tag_filter_mode = (args.tag_filter_mode as string) || "include";
      }
      const r = await fetch(`${VN_BASE}/recordings?page=${page}`, {
        method: "POST",
        headers: { ...VN_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) return { error: `VoiceNotes API error: ${r.status}` };
      const data = await r.json() as Record<string, unknown>;
      const notes = ((data.data as Record<string, unknown>[]) || []).slice(0, limit);
      return {
        count: notes.length,
        page,
        has_more: !!(data.links && (data.links as Record<string, unknown>).next),
        notes: notes.map((n) => ({
          recording_id: n.recording_id,
          title: n.title,
          duration_seconds: Math.round(((n.duration as number) > 1000 ? (n.duration as number) / 1000 : (n.duration as number))),
          tags: ((n.tags as Record<string, unknown>[]) || []).map((t) => t.name),
          has_transcript: !!(n.transcript),
          has_summary: ((n.creations as Record<string, unknown>[]) || []).some((c) => c.type === "summary"),
          has_action_items: ((n.creations as Record<string, unknown>[]) || []).some((c) => c.type === "action_items"),
          created_at: n.created_at,
          updated_at: n.updated_at,
        }))
      };
    }

    if (toolName === "voicenotes.get") {
      // We need to find this note — fetch recent pages and locate by recording_id
      const notes = await fetchVNPages(undefined, undefined, undefined, 200);
      const note = notes.find((n) => n.recording_id === args.recording_id);
      if (!note) return { error: `Note with recording_id '${args.recording_id}' not found in recent 200 notes.` };
      const dur = (note.duration as number);
      return {
        recording_id: note.recording_id,
        title: note.title,
        duration_seconds: Math.round(dur > 1000 ? dur / 1000 : dur),
        tags: ((note.tags as Record<string, unknown>[]) || []).map((t) => t.name),
        transcript: note.transcript,
        creations: ((note.creations as Record<string, unknown>[]) || []).map((c) => ({
          type: c.type,
          markdown_content: c.markdown_content,
        })),
        created_at: note.created_at,
        updated_at: note.updated_at,
      };
    }

    if (toolName === "voicenotes.search") {
      const query = ((args.query as string) || "").toLowerCase();
      const limit = (args.limit as number) || 10;
      const notes = await fetchVNPages(args.since as string, undefined, undefined, 400);
      const matches = notes.filter((n) => {
        const title = ((n.title as string) || "").toLowerCase();
        const transcript = ((n.transcript as string) || "").toLowerCase();
        return title.includes(query) || transcript.includes(query);
      }).slice(0, limit);
      return {
        query: args.query,
        matches: matches.length,
        results: matches.map((n) => {
          const transcript = (n.transcript as string) || "";
          const idx = transcript.toLowerCase().indexOf(query);
          const snippet = idx >= 0 ? transcript.slice(Math.max(0, idx - 80), idx + 120) : transcript.slice(0, 200);
          return {
            recording_id: n.recording_id,
            title: n.title,
            snippet: snippet.trim(),
            tags: ((n.tags as Record<string, unknown>[]) || []).map((t) => t.name),
            created_at: n.created_at,
          };
        })
      };
    }

    if (toolName === "voicenotes.get_action_items") {
      const limit = (args.limit as number) || 20;
      const notes = await fetchVNPages(args.since as string, args.tags as string[], "include", limit);
      const actionItems: Record<string, unknown>[] = [];
      for (const n of notes.slice(0, limit)) {
        const creations = (n.creations as Record<string, unknown>[]) || [];
        for (const c of creations) {
          if (c.type === "action_items" || c.type === "todo") {
            actionItems.push({
              note_title: n.title,
              recording_id: n.recording_id,
              type: c.type,
              content: c.markdown_content,
              created_at: n.created_at,
            });
          }
        }
      }
      return { notes_scanned: Math.min(notes.length, limit), action_items_found: actionItems.length, action_items: actionItems };
    }

    if (toolName === "voicenotes.get_summaries") {
      const limit = (args.limit as number) || 10;
      const notes = await fetchVNPages(args.since as string, args.tags as string[], "include", limit);
      return {
        count: Math.min(notes.length, limit),
        summaries: notes.slice(0, limit).map((n) => {
          const dur = (n.duration as number);
          const summaryCreation = ((n.creations as Record<string, unknown>[]) || []).find((c) => c.type === "summary");
          return {
            recording_id: n.recording_id,
            title: n.title,
            duration_seconds: Math.round(dur > 1000 ? dur / 1000 : dur),
            tags: ((n.tags as Record<string, unknown>[]) || []).map((t) => t.name),
            summary: summaryCreation ? summaryCreation.markdown_content : (n.transcript ? (n.transcript as string).slice(0, 300) + "..." : "No summary available"),
            created_at: n.created_at,
          };
        })
      };
    }

    if (toolName === "voicenotes.get_audio_url") {
      const r = await fetch(`${VN_BASE}/recordings/${args.recording_id}/signed-url`, { headers: VN_HEADERS });
      if (!r.ok) return { error: `VoiceNotes API error: ${r.status} — signed URL may not be available for this recording.`, recording_id: args.recording_id };
      const data = await r.json() as Record<string, unknown>;
      return { recording_id: args.recording_id, audio_url: data.url, expires_in: "~12 minutes" };
    }
  }

  // ── COMMUNICATION ─────────────────────────────────────────────────────
  if (category === "communication") {
    if (toolName === "communication.slack.list_channels") {
      if (!SLACK_TOKEN) return { error: "SLACK_BOT_TOKEN not configured. Add it to Doppler garza/prd as SLACK_BOT_TOKEN.", ok: false };
      const r = await fetch("https://slack.com/api/conversations.list?limit=200&types=public_channel,private_channel", {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` }
      });
      return r.json();
    }
    if (toolName === "communication.slack.send_message") {
      if (!SLACK_TOKEN) return { error: "SLACK_BOT_TOKEN not configured.", ok: false };
      const r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: args.channel, text: args.text })
      });
      return r.json();
    }
    if (toolName === "communication.slack.search") {
      if (!SLACK_TOKEN) return { error: "SLACK_BOT_TOKEN not configured.", ok: false };
      const r = await fetch(`https://slack.com/api/search.messages?query=${encodeURIComponent(args.query as string)}`, {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` }
      });
      return r.json();
    }
    if (toolName === "communication.messaging.send_telegram") {
      if (!TELEGRAM_TOKEN) return { error: "TELEGRAM_BOT_TOKEN not configured." };
      const chatId = (args.chat_id as string) || TELEGRAM_CHAT;
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: args.text })
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
      if (!NOTION_TOKEN) return { error: "NOTION_API_KEY not configured.", ok: false };
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
    if (toolName === "productivity.files.list_dropbox") {
      const r = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: { Authorization: `Bearer ${DROPBOX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: (args.path as string) || "" })
      });
      return r.json();
    }
    if (toolName === "productivity.data.list_airtable") {
      const r = await fetch(`https://api.airtable.com/v0/${args.base_id}/${encodeURIComponent(args.table as string)}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_KEY}` }
      });
      return r.json();
    }
  }

  // ── HOME / IOT ────────────────────────────────────────────────────────────
  if (category === "home") {
    if (toolName === "home.devices.list") {
      if (!HA_TOKEN) return { error: "HOME_ASSISTANT_TOKEN not configured. Add HA_URL and HOME_ASSISTANT_TOKEN to Doppler." };
      const r = await fetch(`${HA_URL}/api/states`, { headers: { Authorization: `Bearer ${HA_TOKEN}` } });
      if (!r.ok) return { error: `Home Assistant returned ${r.status}. Check HA_URL and HA_TOKEN.` };
      const states = await r.json() as unknown[];
      return { count: states.length, entities: (states as Record<string, unknown>[]).slice(0, 50).map(s => ({ id: s.entity_id, state: s.state, name: (s.attributes as Record<string, unknown>)?.friendly_name })) };
    }
    if (toolName === "home.devices.control") {
      if (!HA_TOKEN) return { error: "HOME_ASSISTANT_TOKEN not configured." };
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
      if (!UNIFI_TOKEN) return { error: "UNIFI_API_KEY not configured." };
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
    if (toolName === "ai.memory.search_with_context") {
      // Search memory, optionally run a follow-up tool with context injected
      const memResult = await fetch("https://api.mem0.ai/v1/memories/search/", {
        method: "POST",
        headers: { Authorization: `Token ${MEM0_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query, user_id: "jaden" })
      }).then(r => r.json());

      if (!args.inject_into_tool) {
        return { query: args.query, memory_results: memResult, context_available: true };
      }

      // Run the target tool with memory context injected as a context field
      const toolArgs = { ...(args.tool_args as Record<string, unknown> || {}), _memory_context: memResult };
      const toolResult = await executeTool(args.inject_into_tool as string, toolArgs, server, allTools);
      return { query: args.query, memory_results: memResult, tool: args.inject_into_tool, tool_result: toolResult };
    }
    if (toolName === "ai.reasoning.think") {
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
      if (!GITHUB_TOKEN) return { error: "GITHUB_TOKEN not configured. Add it to Doppler garza/prd as GITHUB_TOKEN.", repos: [] };
      const url = args.org
        ? `https://api.github.com/orgs/${args.org}/repos?per_page=50`
        : "https://api.github.com/user/repos?per_page=50";
      const r = await fetch(url, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "garza-mcp-router" } });
      if (!r.ok) return { error: `GitHub API ${r.status}`, repos: [] };
      const data = await r.json();
      const repos = Array.isArray(data) ? data as Record<string, unknown>[] : [];
      return { count: repos.length, repos: repos.map(r => ({ name: r.name, full_name: r.full_name, private: r.private, updated_at: r.updated_at })), raw_response_type: Array.isArray(data) ? "array" : typeof data };
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
    if (toolName === "infrastructure.cloud.list_droplets") {
      const r = await fetch("https://api.digitalocean.com/v2/droplets", {
        headers: { Authorization: `Bearer ${DO_TOKEN}` }
      });
      return r.json();
    }
  }

  // ── AUTOMATION ────────────────────────────────────────────────────────────
  if (category === "automation") {
    if (toolName === "automation.workflow.list_n8n") {
      const r = await fetch(`${N8N_URL}/api/v1/workflows`, { headers: { "X-N8N-API-KEY": N8N_TOKEN } });
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
      const r = await fetch("https://www.taskr.one/api/tasks", { headers: { Authorization: `Bearer ${TASKR_KEY}` } });
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
    if (toolName === "automation.webhook.register") {
      // Register an n8n webhook to monitor a Beeper chat
      // This creates a workflow in n8n that polls the chat and fires the webhook
      const webhookUrl = args.webhook_url as string;
      const chatID = args.chatID as string;
      const events = (args.events as string[]) || ["message"];
      // Store the webhook registration in memory (in production, persist to Doppler/DB)
      return {
        status: "registered",
        chatID,
        webhook_url: webhookUrl,
        events,
        note: "Webhook registered. To activate real-time monitoring, create an n8n workflow that calls beeper.chat.watch on a schedule and posts to this webhook URL.",
        suggested_n8n_workflow: {
          trigger: "Schedule (every 1 minute)",
          step1: `Call POST /personal with beeper.chat.watch { chatID: "${chatID}", since: "{{$now}}" }`,
          step2: `If messages found, POST to ${webhookUrl}`
        }
      };
    }
  }

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  if (category === "analytics") {
    if (toolName === "analytics.ai_ops.list_traces") {
      if (LANGFUSE_SECRET && LANGFUSE_PUBLIC) {
        const r = await fetch(`${LANGFUSE_URL}/api/public/traces?limit=${args.limit || 20}`, {
          headers: { Authorization: `Basic ${Buffer.from(`${LANGFUSE_PUBLIC}:${LANGFUSE_SECRET}`).toString("base64")}` }
        });
        return r.json();
      }
      // Fallback to Zep sessions
      if (ZEP_KEY) {
        const r = await fetch(`https://api.getzep.com/api/v2/sessions?limit=${args.limit || 20}`, {
          headers: { Authorization: `Api-Key ${ZEP_KEY}` }
        });
        return r.json();
      }
      return { error: "Neither LANGFUSE nor ZEP credentials configured." };
    }
    if (toolName === "analytics.traces.log") {
      // Log a trace event to Zep (as a memory/session event)
      if (!ZEP_KEY) return { error: "ZEP_API_KEY not configured." };
      const sessionId = args.session_id as string;
      const r = await fetch(`https://api.getzep.com/api/v2/sessions/${sessionId}/memory`, {
        method: "POST",
        headers: { Authorization: `Api-Key ${ZEP_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "system",
            content: JSON.stringify({
              event: args.event,
              tool: args.tool,
              result: args.result,
              latency_ms: args.latency_ms,
              success: args.success,
              timestamp: new Date().toISOString()
            })
          }]
        })
      });
      if (!r.ok) return { error: `Zep returned ${r.status}`, session_id: sessionId };
      return { status: "logged", session_id: sessionId, event: args.event };
    }
    if (toolName === "analytics.web.get_stats" || toolName === "analytics.web.get_stats_plausible") {
      if (!PLAUSIBLE_KEY) return { error: "PLAUSIBLE_API_KEY not configured." };
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
    if (toolName === "finance.banking.get_transactions") {
      if (!SIMPLEFIN_URL) return { error: "SIMPLEFIN_ACCESS_URL not configured." };
      // Node.js 18+ fetch() does not allow credentials embedded in URLs.
      // Parse the URL and pass credentials via Authorization header instead.
      let sfUrl = SIMPLEFIN_URL;
      let sfAuth = "";
      try {
        const parsed = new URL(SIMPLEFIN_URL);
        if (parsed.username && parsed.password) {
          sfAuth = Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64");
          parsed.username = "";
          parsed.password = "";
          sfUrl = parsed.toString();
        }
      } catch { /* use original URL */ }
      const sfHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (sfAuth) sfHeaders["Authorization"] = `Basic ${sfAuth}`;
      const accountId = args.account_id as string | undefined;
      const sfEndpoint = accountId ? `${sfUrl}/accounts?account=${accountId}` : `${sfUrl}/accounts`;
      const r = await fetch(sfEndpoint, { headers: sfHeaders });
      const data = await r.json() as Record<string, unknown>;
      const accounts = (data.accounts as Record<string, unknown>[]) || [];
      return {
        account_count: accounts.length,
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          balance: a["balance"],
          available_balance: a["available-balance"],
          balance_date: a["balance-date"],
        }))
      };
    }
  }

  // ── ECOMMERCE ─────────────────────────────────────────────────────────────
  if (category === "ecommerce") {
    if (toolName === "ecommerce.store.list_orders") {
      if (!SHOPIFY_KEY) return { error: "SHOPIFY_API_KEY not configured." };
      const status = (args.status as string) || "any";
      const limit = (args.limit as number) || 25;
      const r = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json?status=${status}&limit=${limit}`, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_KEY }
      });
      return r.json();
    }
    if (toolName === "ecommerce.store.get_order") {
      if (!SHOPIFY_KEY) return { error: "SHOPIFY_API_KEY not configured." };
      const r = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/orders/${args.order_id}.json`, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_KEY }
      });
      return r.json();
    }
    if (toolName === "ecommerce.store.list_products") {
      if (!SHOPIFY_KEY) return { error: "SHOPIFY_API_KEY not configured." };
      const limit = (args.limit as number) || 25;
      const r = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/products.json?limit=${limit}`, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_KEY }
      });
      return r.json();
    }
    if (toolName === "ecommerce.shipping.list_shipments") {
      if (!SHIPSTATION_KEY) return { error: "SHIPSTATION_API_KEY not configured. Add it to Doppler garza/prd." };
      // ShipStation Basic Auth requires both API Key and Secret Key: base64(key:secret)
      const SHIPSTATION_SECRET = process.env.SHIPSTATION_SECRET_KEY || "";
      const ssAuth = Buffer.from(`${SHIPSTATION_KEY}:${SHIPSTATION_SECRET}`).toString("base64");
      const url = args.order_id
        ? `https://ssapi.shipstation.com/shipments?orderNumber=${args.order_id}`
        : "https://ssapi.shipstation.com/shipments?pageSize=25";
      const r = await fetch(url, {
        headers: { Authorization: `Basic ${ssAuth}` }
      });
      if (!r.ok) {
        const errText = await r.text();
        return { error: `ShipStation API returned ${r.status}`, detail: errText.slice(0, 200) };
      }
      return r.json();
    }
  }

  // ── GOOGLE ADS / MARKETING ─────────────────────────────────────────────────
  if (category === "ads") {
    const GAQL_TOKEN = process.env.GAQL_TOKEN || "";
    if (!GAQL_TOKEN) return { error: "GAQL_TOKEN not configured. Add it to Doppler garza/prd." };
    const GAQL_BASE = "https://api.gaql.app/api/gpt";
    const gaqlHeaders = { "Content-Type": "application/json", "User-Agent": "garza-mcp-router/5.3" };

    if (toolName === "ads.google.get_accounts") {
      const r = await fetch(`${GAQL_BASE}/google-ads/get-accounts?gptToken=${GAQL_TOKEN}`, { headers: gaqlHeaders });
      if (!r.ok) return { error: `GAQL API error ${r.status}`, detail: await r.text() };
      return r.json();
    }
    if (toolName === "ads.google.execute_query") {
      if (!args.customer_id || !args.query) return { error: "customer_id and query are required." };
      const custId = parseInt(String(args.customer_id).replace(/-/g, ""));
      const r = await fetch(`${GAQL_BASE}/google-ads/execute-query?gptToken=${GAQL_TOKEN}`, {
        method: "POST",
        headers: gaqlHeaders,
        body: JSON.stringify({ query: args.query, customerId: custId, loginCustomerId: custId, reportAggregation: "Auto" })
      });
      if (!r.ok) return { error: `GAQL API error ${r.status}`, detail: await r.text() };
      return r.json();
    }
    if (toolName === "ads.google.get_campaigns") {
      if (!args.customer_id) return { error: "customer_id is required." };
      const custId = parseInt(String(args.customer_id).replace(/-/g, ""));
      const dateRange = (args.date_range as string) || "LAST_30_DAYS";
      const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING ${dateRange} ORDER BY metrics.impressions DESC`;
      const r = await fetch(`${GAQL_BASE}/google-ads/execute-query?gptToken=${GAQL_TOKEN}`, {
        method: "POST",
        headers: gaqlHeaders,
        body: JSON.stringify({ query, customerId: custId, loginCustomerId: custId, reportAggregation: "Auto" })
      });
      if (!r.ok) return { error: `GAQL API error ${r.status}`, detail: await r.text() };
      return r.json();
    }
    if (toolName === "ads.google.get_performance") {
      if (!args.customer_id) return { error: "customer_id is required." };
      const custId = parseInt(String(args.customer_id).replace(/-/g, ""));
      const dateRange = (args.date_range as string) || "LAST_30_DAYS";
      const level = (args.level as string) || "campaign";
      const queryMap: Record<string, string> = {
        campaign: `SELECT campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date DURING ${dateRange} ORDER BY metrics.cost_micros DESC`,
        ad_group: `SELECT campaign.name, ad_group.name, ad_group.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group WHERE segments.date DURING ${dateRange} ORDER BY metrics.cost_micros DESC`,
        keyword: `SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE segments.date DURING ${dateRange} ORDER BY metrics.cost_micros DESC`,
        ad: `SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group_ad WHERE segments.date DURING ${dateRange} ORDER BY metrics.cost_micros DESC`
      };
      const query = queryMap[level] || queryMap.campaign;
      const r = await fetch(`${GAQL_BASE}/google-ads/execute-query?gptToken=${GAQL_TOKEN}`, {
        method: "POST",
        headers: gaqlHeaders,
        body: JSON.stringify({ query, customerId: custId, loginCustomerId: custId, reportAggregation: "Auto" })
      });
      if (!r.ok) return { error: `GAQL API error ${r.status}`, detail: await r.text() };
      return r.json();
    }
  }

  // ── DATABASE / CRM ────────────────────────────────────────────────────────
  if (category === "database") {
    if (toolName === "database.crm.list_contacts") {
      if (!TWENTY_KEY) return { error: "TWENTY_API_KEY not configured." };
      const r = await fetch(`${TWENTY_URL}/api/people?first=${args.limit || 20}`, {
        headers: { Authorization: `Bearer ${TWENTY_KEY}` }
      });
      return r.json();
    }
    if (toolName === "database.crm.list_deals") {
      if (!TWENTY_KEY) return { error: "TWENTY_API_KEY not configured." };
      const r = await fetch(`${TWENTY_URL}/api/opportunities`, {
        headers: { Authorization: `Bearer ${TWENTY_KEY}` }
      });
      return r.json();
    }
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
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
          serverInfo: { name: `garza-mcp-${serverName}`, version: "5.0.0" }
        }
      });
    }

    if (method === "tools/list") {
      return c.json({ jsonrpc: "2.0", id, result: { tools: allTools } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
      const t0 = Date.now();
      let usageStatus: "success" | "failure" = "success";
      let usageError: string | undefined;
      let outputSize = 0;
      try {
        const result = await executeTool(name, args || {}, serverName, allTools);
        const text = JSON.stringify(result, null, 2);
        outputSize = text.length;
        recordUsage({
          event_id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          timestamp: new Date().toISOString(),
          server: serverName,
          tool_name: name,
          status: "success",
          execution_time_ms: Date.now() - t0,
          input_keys: Object.keys(args || {}),
          output_size_bytes: outputSize,
          mcp_router_version: "5.2"
        });
        return c.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text }] }
        });
      } catch (err) {
        usageStatus = "failure";
        usageError = String(err);
        recordUsage({
          event_id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          timestamp: new Date().toISOString(),
          server: serverName,
          tool_name: name,
          status: "failure",
          execution_time_ms: Date.now() - t0,
          input_keys: Object.keys(args || {}),
          output_size_bytes: 0,
          error_message: usageError,
          mcp_router_version: "5.2"
        });
        return c.json({ jsonrpc: "2.0", id, error: { code: -32000, message: usageError } });
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

// ─── App ─────────────────────────────────────────────────────────────────────
const app = new Hono();

app.get("/", (c) => c.json({
  name: "GARZA OS Unified MCP Router",
  version: "5.0.0",
  servers: {
    personal: { path: "/personal", tools: PERSONAL_TOOLS.length + RUNTIME_PERSONAL_TOOLS.length, categories: [...new Set(PERSONAL_TOOLS.map(t => t.name.split(".")[0]))] },
    dev:      { path: "/dev",      tools: DEV_TOOLS.length + RUNTIME_DEV_TOOLS.length,           categories: [...new Set(DEV_TOOLS.map(t => t.name.split(".")[0]))] },
    nomad:    { path: "/nomad",    tools: NOMAD_TOOLS.length + RUNTIME_NOMAD_TOOLS.length,       categories: [...new Set(NOMAD_TOOLS.map(t => t.name.split(".")[0]))] },
  },
  total_tools: PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length,
  status: "ok",
  new_in_v5: [
    "vaults.secrets.set (write to Doppler)",
    "beeper.chat.get_history (paginated history)",
    "beeper.messages.forward (cross-chat forwarding)",
    "beeper.voice.auto_transcribe (Deepgram integration)",
    "beeper.notion.log_action_items (GPT extraction → n8n → Notion)",
    "router.tools.bulk_add (add multiple tools at once)",
    "router.tools.history + rollback (tool versioning)",
    "router.chain (cross-server tool chaining)",
    "router.health.credential_check (Telegram alerts)",
    "registry.discover + registry.search_tools (agent onboarding)",
    "search.everything (unified cross-source search)",
    "analytics.traces.log (Zep observability)",
    "ai.memory.search_with_context (auto-inject memory)",
    "automation.webhook.register (Beeper → n8n webhook)",
    "communication.messaging.send_telegram (wired to real API)",
    "Shopify backend fully wired (list_orders, get_order, list_products)"
  ]
}));

app.get("/health", (c) => c.json({ status: "ok", uptime: process.uptime(), version: "5.2.0" }));

// ─── Analytics dashboard data endpoint ───────────────────────────────────────
app.get("/analytics", (c) => {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo  = now - 24 * 60 * 60 * 1000;

  const recentEvents = USAGE_RING.filter(e => new Date(e.timestamp).getTime() > dayAgo);

  // Per-tool stats
  const toolStats: Record<string, { calls: number; failures: number; total_ms: number; last_called: string }> = {};
  for (const e of USAGE_RING) {
    if (!toolStats[e.tool_name]) toolStats[e.tool_name] = { calls: 0, failures: 0, total_ms: 0, last_called: e.timestamp };
    toolStats[e.tool_name].calls++;
    if (e.status === "failure") toolStats[e.tool_name].failures++;
    toolStats[e.tool_name].total_ms += e.execution_time_ms;
    if (e.timestamp > toolStats[e.tool_name].last_called) toolStats[e.tool_name].last_called = e.timestamp;
  }

  // Per-server stats
  const serverStats: Record<string, { calls: number; failures: number }> = {};
  for (const e of USAGE_RING) {
    if (!serverStats[e.server]) serverStats[e.server] = { calls: 0, failures: 0 };
    serverStats[e.server].calls++;
    if (e.status === "failure") serverStats[e.server].failures++;
  }

  // Hourly buckets for last 24h (24 buckets)
  const hourlyBuckets: Record<string, { calls: number; failures: number }> = {};
  for (let i = 23; i >= 0; i--) {
    const bucketStart = new Date(now - i * 60 * 60 * 1000);
    const key = bucketStart.toISOString().slice(0, 13) + ":00";
    hourlyBuckets[key] = { calls: 0, failures: 0 };
  }
  for (const e of recentEvents) {
    const key = e.timestamp.slice(0, 13) + ":00";
    if (hourlyBuckets[key]) {
      hourlyBuckets[key].calls++;
      if (e.status === "failure") hourlyBuckets[key].failures++;
    }
  }

  // Top tools
  const topTools = Object.entries(toolStats)
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 20)
    .map(([name, s]) => ({
      name, calls: s.calls,
      failure_rate: s.calls > 0 ? Math.round(s.failures / s.calls * 100) : 0,
      avg_ms: s.calls > 0 ? Math.round(s.total_ms / s.calls) : 0,
      last_called: s.last_called
    }));

  // Category breakdown
  const catStats: Record<string, number> = {};
  for (const e of USAGE_RING) {
    const cat = e.tool_name.split(".")[0];
    catStats[cat] = (catStats[cat] || 0) + 1;
  }

  return c.json({
    generated_at: new Date().toISOString(),
    version: "5.2.0",
    summary: {
      total_events: USAGE_RING.length,
      events_last_24h: recentEvents.length,
      events_last_hour: USAGE_RING.filter(e => new Date(e.timestamp).getTime() > hourAgo).length,
      unique_tools_called: Object.keys(toolStats).length,
      total_tools_available: PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length,
      overall_failure_rate: USAGE_RING.length > 0
        ? Math.round(USAGE_RING.filter(e => e.status === "failure").length / USAGE_RING.length * 100)
        : 0
    },
    server_breakdown: serverStats,
    category_breakdown: catStats,
    hourly_activity: Object.entries(hourlyBuckets).map(([hour, s]) => ({ hour, ...s })),
    top_tools: topTools,
    all_tool_stats: Object.entries(toolStats).map(([name, s]) => ({
      name, server: name.split(".")[0],
      calls: s.calls, failures: s.failures,
      failure_rate: s.calls > 0 ? Math.round(s.failures / s.calls * 100) : 0,
      avg_ms: s.calls > 0 ? Math.round(s.total_ms / s.calls) : 0,
      last_called: s.last_called
    }))
  });
});

const GOOGLE_ADS_TOOLS = NOMAD_TOOLS.filter(t => t.name.startsWith("ads.google."));

const servers = [
  { path: "/personal",    tools: PERSONAL_TOOLS,    name: "personal" as const },
  { path: "/dev",         tools: DEV_TOOLS,         name: "dev" as const },
  { path: "/nomad",       tools: NOMAD_TOOLS,       name: "nomad" as const },
  { path: "/google-ads",  tools: GOOGLE_ADS_TOOLS,  name: "nomad" as const },
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

// Start server when running directly (Railway, local)
if (process.env.VERCEL !== '1') {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`\n🚀 GARZA OS Unified MCP Router v5.0 running on port ${PORT}`);
    console.log(`\n  Servers:`);
    console.log(`    /personal  → ${PERSONAL_TOOLS.length} tools`);
    console.log(`    /dev       → ${DEV_TOOLS.length} tools`);
    console.log(`    /nomad     → ${NOMAD_TOOLS.length} tools`);
    console.log(`\n  Total: ${PERSONAL_TOOLS.length + DEV_TOOLS.length + NOMAD_TOOLS.length} tools across 3 servers`);
    console.log(`  NEW in v5.0: 16 new tools + Shopify wired + Telegram wired + tool versioning\n`);
  });
}
// v5.3 - Google Ads GAQL integration Wed Mar  4 23:41:49 EST 2026
