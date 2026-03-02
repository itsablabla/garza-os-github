import { Hono } from 'hono';
import { serve } from '@hono/node-server';
// ============================================================
// GARZA OS PERSONAL MCP GATEWAY v1.0
// Stack: garza-tools (personal)
// Categories: vaults, communication, productivity, home, ai_memory, web
// URL: https://garza-personal-gateway-production.up.railway.app
// ============================================================
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || 'garza-personal-2025';
const PORT = parseInt(process.env.PORT || '8080');
const DOPPLER_TOKEN = process.env.DOPPLER_TOKEN || '';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  backend: BackendDef;
}
interface BackendDef {
  type: 'http' | 'npx';
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
    'SLACK_BOT_TOKEN', 'SLACK_TEAM_ID',
    'NOTION_API_KEY',
    'GMAIL_TOKEN', 'GOOGLE_DRIVE_TOKEN', 'GOOGLE_CALENDAR_TOKEN',
    'TELEGRAM_BOT_TOKEN',
    'DROPBOX_TOKEN',
    'BEEPER_API_KEY',
    'PROTON_API_TOKEN',
    'HA_TOKEN', 'HA_URL',
    'UNIFI_API_KEY', 'UNIFI_HOST',
    'AIRTABLE_API_KEY',
    'MEM0_API_KEY',
    'ZEP_API_KEY',
    'TAILSCALE_API_KEY',
    'FIRECRAWL_API_KEY',
    'GRAPHITI_TOKEN',
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

async function callHttpTool(backend: BackendDef, toolName: string, args: any): Promise<any> {
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
  // Handle SSE response
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
  // VAULTS — Doppler + Bitwarden
  // ============================================================
  tools.push({
    name: 'vaults.secrets.list',
    description: 'List all secret names in a Doppler project. Use to discover what credentials are available without exposing values.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'garza or garza-os', default: 'garza' }, config: { type: 'string', default: 'prd' } } },
    backend: { type: 'http', url: `https://api.doppler.com/v3/configs/config/secrets?project=garza&config=prd`, authHeader: 'Authorization', authEnvKey: 'DOPPLER_TOKEN', originalMethod: 'list_secrets' }
  });
  tools.push({
    name: 'vaults.secrets.get',
    description: 'Retrieve a specific secret value from Doppler. Use to fetch API keys, tokens, and passwords stored in the Garza OS vault.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', default: 'garza' }, config: { type: 'string', default: 'prd' }, name: { type: 'string', description: 'Secret key name (e.g. STRIPE_SECRET_KEY)' } }, required: ['name'] },
    backend: { type: 'http', url: '', authEnvKey: 'DOPPLER_TOKEN', originalMethod: 'get_secret' }
  });
  tools.push({
    name: 'vaults.passwords.search',
    description: 'Search Bitwarden vault for a password or credential by name, URL, or username. Returns matching items with usernames.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term (site name, URL, username)' } }, required: ['query'] },
    backend: { type: 'http', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'search_vault' }
  });
  tools.push({
    name: 'vaults.passwords.get_item',
    description: 'Retrieve a specific Bitwarden vault item including password and notes by item ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Bitwarden item ID' } }, required: ['id'] },
    backend: { type: 'http', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'get_item' }
  });

  // ============================================================
  // COMMUNICATION — Slack, Gmail, Notion, Telegram, Beeper, ProtonMail
  // ============================================================
  tools.push({
    name: 'communication.slack.send_message',
    description: 'Send a Slack message to a channel or user. Use for team notifications, alerts, or direct messages.',
    inputSchema: { type: 'object', properties: { channel: { type: 'string', description: 'Channel name (#general) or user ID' }, text: { type: 'string' }, thread_ts: { type: 'string' } }, required: ['channel', 'text'] },
    backend: { type: 'npx', originalMethod: 'slack_post_message' }
  });
  tools.push({
    name: 'communication.slack.search_messages',
    description: 'Search Slack messages across all channels and DMs.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'number', default: 10 } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'slack_search_messages' }
  });
  tools.push({
    name: 'communication.slack.list_channels',
    description: 'List all Slack channels in the workspace.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 50 } } },
    backend: { type: 'npx', originalMethod: 'slack_list_channels' }
  });
  tools.push({
    name: 'communication.email.send_gmail',
    description: 'Send an email via Gmail. Use for personal or business email from the Garza Gmail account.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' } }, required: ['to', 'subject', 'body'] },
    backend: { type: 'npx', originalMethod: 'send_email' }
  });
  tools.push({
    name: 'communication.email.search_gmail',
    description: 'Search Gmail inbox. Supports Gmail search syntax: from:, to:, subject:, has:attachment, is:unread, etc.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number', default: 10 } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'search_emails' }
  });
  tools.push({
    name: 'communication.email.send_protonmail',
    description: 'Send a secure encrypted email via ProtonMail (garzasecure@pm.me). Use for sensitive or private communications.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
    backend: { type: 'http', url: 'https://protonmail-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'PROTON_API_TOKEN', originalMethod: 'send_email' }
  });
  tools.push({
    name: 'communication.telegram.send_message',
    description: 'Send a Telegram message to a chat, group, or channel.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' }, parse_mode: { type: 'string', enum: ['Markdown', 'HTML'] } }, required: ['chat_id', 'text'] },
    backend: { type: 'npx', originalMethod: 'send_message' }
  });
  tools.push({
    name: 'communication.beeper.send_message',
    description: 'Send a message via Beeper (unified chat — iMessage, WhatsApp, Signal, etc.).',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' } }, required: ['chat_id', 'text'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'send_message' }
  });
  tools.push({
    name: 'communication.beeper.list_chats',
    description: 'List all Beeper chats and recent conversations.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'list_chats' }
  });

  // ============================================================
  // PRODUCTIVITY — Notion, Google Drive, Google Calendar, Airtable, Dropbox
  // ============================================================
  tools.push({
    name: 'productivity.notion.create_page',
    description: 'Create a new Notion page. Use to document findings, create reports, save research, or build knowledge base entries.',
    inputSchema: { type: 'object', properties: { parent_id: { type: 'string', description: 'Parent page or database ID' }, title: { type: 'string' }, content: { type: 'string', description: 'Page content in Markdown' } }, required: ['parent_id', 'title'] },
    backend: { type: 'npx', originalMethod: 'create_page' }
  });
  tools.push({
    name: 'productivity.notion.search',
    description: 'Search Notion workspace for pages, databases, and content.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, filter_type: { type: 'string', enum: ['page', 'database'] } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'search' }
  });
  tools.push({
    name: 'productivity.notion.update_page',
    description: 'Update an existing Notion page content or properties.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, content: { type: 'string' }, properties: { type: 'object' } }, required: ['page_id'] },
    backend: { type: 'npx', originalMethod: 'update_page' }
  });
  tools.push({
    name: 'productivity.calendar.list_events',
    description: 'List upcoming Google Calendar events. Use to check schedule, find free time, or review upcoming meetings.',
    inputSchema: { type: 'object', properties: { calendar_id: { type: 'string', default: 'primary' }, max_results: { type: 'number', default: 10 }, time_min: { type: 'string', description: 'ISO 8601 datetime' } } },
    backend: { type: 'npx', originalMethod: 'list_events' }
  });
  tools.push({
    name: 'productivity.calendar.create_event',
    description: 'Create a new Google Calendar event.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string', description: 'ISO 8601 datetime' }, end: { type: 'string', description: 'ISO 8601 datetime' }, description: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'start', 'end'] },
    backend: { type: 'npx', originalMethod: 'create_event' }
  });
  tools.push({
    name: 'productivity.drive.list_files',
    description: 'List files in Google Drive. Use to find documents, spreadsheets, or any stored files.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Drive search query' }, page_size: { type: 'number', default: 20 } } },
    backend: { type: 'npx', originalMethod: 'list_files' }
  });
  tools.push({
    name: 'productivity.drive.read_file',
    description: 'Read the content of a Google Drive file.',
    inputSchema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] },
    backend: { type: 'npx', originalMethod: 'read_file' }
  });
  tools.push({
    name: 'productivity.airtable.list_records',
    description: 'List records from an Airtable base and table.',
    inputSchema: { type: 'object', properties: { base_id: { type: 'string' }, table_name: { type: 'string' }, filter_formula: { type: 'string' }, max_records: { type: 'number', default: 100 } }, required: ['base_id', 'table_name'] },
    backend: { type: 'npx', originalMethod: 'list_records' }
  });
  tools.push({
    name: 'productivity.airtable.create_record',
    description: 'Create a new record in an Airtable table.',
    inputSchema: { type: 'object', properties: { base_id: { type: 'string' }, table_name: { type: 'string' }, fields: { type: 'object' } }, required: ['base_id', 'table_name', 'fields'] },
    backend: { type: 'npx', originalMethod: 'create_record' }
  });
  tools.push({
    name: 'productivity.dropbox.list_files',
    description: 'List files and folders in Dropbox.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', default: '' }, recursive: { type: 'boolean', default: false } } },
    backend: { type: 'npx', originalMethod: 'list_folder' }
  });

  // ============================================================
  // HOME — Home Assistant, UniFi
  // ============================================================
  tools.push({
    name: 'home.automation.get_states',
    description: 'Get the current state of all Home Assistant entities (lights, sensors, switches, thermostats, etc.).',
    inputSchema: { type: 'object', properties: { entity_id: { type: 'string', description: 'Optional: filter to specific entity (e.g. light.living_room)' } } },
    backend: { type: 'http', url: 'https://ha-central-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'HA_TOKEN', originalMethod: 'get_states' }
  });
  tools.push({
    name: 'home.automation.call_service',
    description: 'Call a Home Assistant service to control devices. Use to turn lights on/off, set thermostat, lock doors, etc.',
    inputSchema: { type: 'object', properties: { domain: { type: 'string', description: 'Service domain (light, switch, climate, lock, etc.)' }, service: { type: 'string', description: 'Service name (turn_on, turn_off, set_temperature, etc.)' }, entity_id: { type: 'string' }, data: { type: 'object' } }, required: ['domain', 'service'] },
    backend: { type: 'http', url: 'https://ha-central-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'HA_TOKEN', originalMethod: 'call_service' }
  });
  tools.push({
    name: 'home.network.list_clients',
    description: 'List all devices connected to the UniFi network. Shows device name, IP, MAC, and connection status.',
    inputSchema: { type: 'object', properties: { site: { type: 'string', default: 'default' } } },
    backend: { type: 'http', url: 'https://unifi-mcp-server-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'UNIFI_API_KEY', originalMethod: 'list_clients' }
  });
  tools.push({
    name: 'home.network.get_stats',
    description: 'Get UniFi network statistics including bandwidth usage, connected devices count, and network health.',
    inputSchema: { type: 'object', properties: { site: { type: 'string', default: 'default' } } },
    backend: { type: 'http', url: 'https://unifi-mcp-server-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'UNIFI_API_KEY', originalMethod: 'get_stats' }
  });

  // ============================================================
  // AI MEMORY — Mem0, Zep, Graphiti, Sequential Thinking
  // ============================================================
  tools.push({
    name: 'ai.memory.add',
    description: 'Add a memory to Mem0 for long-term AI memory persistence. Use to remember user preferences, facts, or context.',
    inputSchema: { type: 'object', properties: { content: { type: 'string' }, user_id: { type: 'string', default: 'jaden' }, metadata: { type: 'object' } }, required: ['content'] },
    backend: { type: 'npx', originalMethod: 'add_memory' }
  });
  tools.push({
    name: 'ai.memory.search',
    description: 'Search Mem0 memory for relevant past context, preferences, or facts.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, user_id: { type: 'string', default: 'jaden' }, limit: { type: 'number', default: 10 } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'search_memory' }
  });
  tools.push({
    name: 'ai.memory.zep_search',
    description: 'Search Zep memory graph for past conversations and extracted facts.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, session_id: { type: 'string' } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'search' }
  });
  tools.push({
    name: 'ai.memory.graphiti_search',
    description: 'Search Graphiti knowledge graph for entities, relationships, and temporal facts.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, num_results: { type: 'number', default: 5 } }, required: ['query'] },
    backend: { type: 'http', url: 'https://graphiti-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'GRAPHITI_TOKEN', originalMethod: 'search' }
  });
  tools.push({
    name: 'ai.reasoning.think',
    description: 'Use sequential thinking to break down a complex problem step by step. Use for multi-step reasoning, planning, or analysis.',
    inputSchema: { type: 'object', properties: { thought: { type: 'string' }, next_thought_needed: { type: 'boolean' }, thought_number: { type: 'number' }, total_thoughts: { type: 'number' } }, required: ['thought', 'next_thought_needed', 'thought_number', 'total_thoughts'] },
    backend: { type: 'npx', originalMethod: 'sequentialthinking' }
  });
  tools.push({
    name: 'ai.memory.tailscale_devices',
    description: 'List all devices on the Tailscale network. Use to check connectivity of remote machines and services.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'npx', originalMethod: 'list_devices' }
  });

  // ============================================================
  // BEEPER ENHANCED — Full chat API + voice transcription + search + monitoring
  // ============================================================
  tools.push({
    name: 'beeper.chats.list',
    description: 'List all Beeper chats across all connected networks (iMessage, WhatsApp, Signal, Telegram, etc.). Returns chat IDs, names, networks, and last message timestamps.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, description: 'Max chats to return' }, network: { type: 'string', description: 'Filter by network: imessage, whatsapp, signal, telegram, discord, slack' } } },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'list_chats' }
  });
  tools.push({
    name: 'beeper.chats.get_messages',
    description: 'Get recent messages from a specific Beeper chat. Use to read a conversation history.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string', description: 'Beeper chat/room ID' }, limit: { type: 'number', default: 20 } }, required: ['chat_id'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'get_messages' }
  });
  tools.push({
    name: 'beeper.chats.send_message',
    description: 'Send a message to a Beeper chat (iMessage, WhatsApp, Signal, etc.). Use the chat_id from beeper.chats.list.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' }, reply_to_id: { type: 'string', description: 'Optional: message ID to reply to' } }, required: ['chat_id', 'text'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'send_message' }
  });
  tools.push({
    name: 'beeper.chats.get_unread',
    description: 'Get all unread messages across all Beeper chats and networks. Use to check for new messages without reading each chat individually.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 50 } } },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'get_unread' }
  });
  tools.push({
    name: 'beeper.chats.mark_read',
    description: 'Mark all messages in a Beeper chat as read.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' } }, required: ['chat_id'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'mark_read' }
  });
  tools.push({
    name: 'beeper.chats.search',
    description: 'Search across all Beeper chats and messages by keyword. Searches message content, sender names, and chat names across all connected networks.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term' }, network: { type: 'string', description: 'Optional: limit to specific network' }, limit: { type: 'number', default: 20 } }, required: ['query'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'search_messages' }
  });
  tools.push({
    name: 'beeper.chats.summarize',
    description: 'Get a summary of recent activity in a Beeper chat. Returns the last N messages formatted for quick review.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, message_count: { type: 'number', default: 30, description: 'Number of recent messages to summarize' } }, required: ['chat_id'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'get_messages' }
  });
  tools.push({
    name: 'beeper.chats.watch',
    description: 'Poll a Beeper chat for new messages since a given timestamp. Use for monitoring a conversation for replies.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, since_timestamp: { type: 'string', description: 'ISO 8601 datetime — only return messages after this time' } }, required: ['chat_id'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'get_messages_since' }
  });
  tools.push({
    name: 'beeper.media.list_voice_memos',
    description: 'Find all voice memo / audio messages in a Beeper chat. Returns message IDs and download URLs for audio files.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, limit: { type: 'number', default: 20 } }, required: ['chat_id'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'list_media' }
  });
  tools.push({
    name: 'beeper.media.transcribe_voice',
    description: 'Download and transcribe a voice memo from Beeper using Whisper speech-to-text. Provide the message_id or audio_url from beeper.media.list_voice_memos.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string', description: 'Chat containing the voice memo' }, message_id: { type: 'string', description: 'Message ID of the voice memo' }, audio_url: { type: 'string', description: 'Direct URL to audio file (alternative to message_id)' } } },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'transcribe_voice_memo' }
  });
  tools.push({
    name: 'beeper.media.list_media',
    description: 'List all media files (images, videos, documents, audio) shared in a Beeper chat.',
    inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, media_type: { type: 'string', enum: ['image', 'video', 'audio', 'document', 'all'], default: 'all' }, limit: { type: 'number', default: 30 } }, required: ['chat_id'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'list_media' }
  });
  tools.push({
    name: 'beeper.contacts.find',
    description: 'Find a contact across all Beeper-connected networks by name, phone number, or username.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Name, phone number, or username to search for' } }, required: ['query'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'search_contacts' }
  });
  tools.push({
    name: 'beeper.networks.list',
    description: 'List all connected chat networks in Beeper (iMessage, WhatsApp, Signal, Telegram, Discord, etc.) and their connection status.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'list_networks' }
  });
  tools.push({
    name: 'beeper.networks.get_chats_by_network',
    description: 'List all chats for a specific network (e.g. all iMessage chats, all WhatsApp chats).',
    inputSchema: { type: 'object', properties: { network: { type: 'string', description: 'Network name: imessage, whatsapp, signal, telegram, discord, slack, instagram' } }, required: ['network'] },
    backend: { type: 'http', url: 'https://beeper-mcp-api-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'BEEPER_API_KEY', originalMethod: 'list_chats_by_network' }
  });

  // ============================================================
  // ROUTER MANAGEMENT — Self-service tool management for any agent
  // ============================================================
  tools.push({
    name: 'router.tools.list',
    description: 'List all tools registered on this MCP server with their categories, descriptions, and backend types. Use to discover what capabilities are available.',
    inputSchema: { type: 'object', properties: { category: { type: 'string', description: 'Optional: filter by category (e.g. beeper, vaults, communication)' } } },
    backend: { type: 'http', url: '', originalMethod: 'router_list_tools' }
  });
  tools.push({
    name: 'router.tools.add',
    description: 'Dynamically add a new tool to this MCP server at runtime without redeploying. The tool will be available immediately after adding.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Tool name in category.subcategory.action format' }, description: { type: 'string' }, inputSchema: { type: 'object' }, backend_url: { type: 'string', description: 'HTTP endpoint URL' }, backend_method: { type: 'string', description: 'Method name to call on the backend' }, auth_env_key: { type: 'string', description: 'Env var key for auth token' } }, required: ['name', 'description', 'backend_url', 'backend_method'] },
    backend: { type: 'http', url: '', originalMethod: 'router_add_tool' }
  });
  tools.push({
    name: 'router.tools.update',
    description: 'Update an existing tool on this MCP server — change its description, schema, or backend endpoint.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Tool name to update' }, description: { type: 'string' }, backend_url: { type: 'string' }, backend_method: { type: 'string' } }, required: ['name'] },
    backend: { type: 'http', url: '', originalMethod: 'router_update_tool' }
  });
  tools.push({
    name: 'router.tools.remove',
    description: 'Remove a dynamically-added tool from this MCP server. Note: built-in tools cannot be removed without redeployment.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Tool name to remove' } }, required: ['name'] },
    backend: { type: 'http', url: '', originalMethod: 'router_remove_tool' }
  });
  tools.push({
    name: 'router.tools.test',
    description: 'Test a specific tool with sample arguments and return the raw result. Use to debug or verify a tool is working correctly.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, args: { type: 'object', description: 'Arguments to pass to the tool' } }, required: ['tool_name'] },
    backend: { type: 'http', url: '', originalMethod: 'router_test_tool' }
  });
  tools.push({
    name: 'router.server.status',
    description: 'Get the current status of this MCP server: version, uptime, tool count, loaded credentials, and deployment info.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: '', originalMethod: 'router_status' }
  });
  tools.push({
    name: 'router.server.redeploy',
    description: 'Trigger a redeployment of this MCP server to pick up any source code changes pushed to GitHub.',
    inputSchema: { type: 'object', properties: { reason: { type: 'string', description: 'Reason for redeployment (for audit log)' } } },
    backend: { type: 'http', url: '', originalMethod: 'router_redeploy' }
  });

  // ============================================================
  // WEB — Firecrawl scraping, Playwright browser
  // ============================================================
  tools.push({
    name: 'web.scraping.scrape',
    description: 'Scrape a webpage and extract its content as clean Markdown. Use for reading articles, documentation, or any public web content.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, formats: { type: 'array', items: { type: 'string' }, default: ['markdown'] } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'firecrawl_scrape' }
  });
  tools.push({
    name: 'web.scraping.search',
    description: 'Search the web and return results with scraped content. Use for research, fact-checking, or finding current information.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'firecrawl_search' }
  });
  tools.push({
    name: 'web.browser.navigate',
    description: 'Navigate a browser to a URL and interact with the page. Use for web automation, form filling, or testing.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'browser_navigate' }
  });
  tools.push({
    name: 'web.filesystem.read',
    description: 'Read a file from the local filesystem.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    backend: { type: 'npx', originalMethod: 'read_file' }
  });

  return tools;
}

// ============================================================
// DIRECT API HANDLERS for tools that don't proxy to another MCP
// ============================================================
async function executeTool(tool: ToolDef, args: any): Promise<any> {
  const { backend } = tool;

  // Special direct API handlers
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

  // Router management tools — handled directly
  if (tool.name === 'router.tools.list') {
    const category = args.category;
    let filtered = toolRegistry;
    if (category) filtered = toolRegistry.filter(t => t.name.startsWith(category + '.'));
    const categories: Record<string, number> = {};
    toolRegistry.forEach(t => { const cat = t.name.split('.')[0]; categories[cat] = (categories[cat] || 0) + 1; });
    return { content: [{ type: 'text', text: JSON.stringify({
      total_tools: toolRegistry.length,
      categories,
      tools: filtered.map(t => ({ name: t.name, description: t.description.slice(0, 100) + '...', backend_type: t.backend.type }))
    }) }] };
  }

  if (tool.name === 'router.tools.add') {
    const newTool: ToolDef = {
      name: args.name,
      description: args.description,
      inputSchema: args.inputSchema || { type: 'object', properties: {} },
      backend: { type: 'http', url: args.backend_url, authEnvKey: args.auth_env_key, authHeader: args.auth_env_key ? 'Authorization' : undefined, originalMethod: args.backend_method }
    };
    if (toolRegistry.find(t => t.name === args.name)) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Tool ${args.name} already exists. Use router.tools.update to modify it.` }) }] };
    }
    toolRegistry.push(newTool);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Tool ${args.name} added. Total tools: ${toolRegistry.length}` }) }] };
  }

  if (tool.name === 'router.tools.update') {
    const idx = toolRegistry.findIndex(t => t.name === args.name);
    if (idx === -1) return { content: [{ type: 'text', text: JSON.stringify({ error: `Tool ${args.name} not found` }) }] };
    if (args.description) toolRegistry[idx].description = args.description;
    if (args.backend_url) toolRegistry[idx].backend.url = args.backend_url;
    if (args.backend_method) toolRegistry[idx].backend.originalMethod = args.backend_method;
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Tool ${args.name} updated` }) }] };
  }

  if (tool.name === 'router.tools.remove') {
    const idx = toolRegistry.findIndex(t => t.name === args.name);
    if (idx === -1) return { content: [{ type: 'text', text: JSON.stringify({ error: `Tool ${args.name} not found` }) }] };
    toolRegistry.splice(idx, 1);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Tool ${args.name} removed. Total tools: ${toolRegistry.length}` }) }] };
  }

  if (tool.name === 'router.tools.test') {
    const targetTool = toolRegistry.find(t => t.name === args.tool_name);
    if (!targetTool) return { content: [{ type: 'text', text: JSON.stringify({ error: `Tool ${args.tool_name} not found` }) }] };
    try {
      const result = await executeTool(targetTool, args.args || {});
      return { content: [{ type: 'text', text: JSON.stringify({ tool: args.tool_name, result }) }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: JSON.stringify({ tool: args.tool_name, error: e.message }) }] };
    }
  }

  if (tool.name === 'router.server.status') {
    const cats: Record<string, number> = {};
    toolRegistry.forEach(t => { const cat = t.name.split('.')[0]; cats[cat] = (cats[cat] || 0) + 1; });
    return { content: [{ type: 'text', text: JSON.stringify({
      server: 'GARZA OS Personal MCP Gateway',
      version: '2.0.0',
      stack: 'garza-tools (personal)',
      total_tools: toolRegistry.length,
      categories: cats,
      credentials_loaded: Object.keys(creds).length,
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version
    }) }] };
  }

  if (tool.name === 'router.server.redeploy') {
    const vercelToken = getCred('VERCEL_TOKEN');
    if (!vercelToken) return { content: [{ type: 'text', text: JSON.stringify({ error: 'VERCEL_TOKEN not configured' }) }] };
    try {
      const res = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'garza-personal-gateway', gitSource: { type: 'github', repoId: 'garza-os-github', ref: 'main' } })
      });
      const data = await res.json() as any;
      return { content: [{ type: 'text', text: JSON.stringify({ triggered: true, deployment_id: data.id, reason: args.reason || 'manual', url: data.url }) }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] };
    }
  }

  if (backend.type === 'http') {
    return await callHttpTool(backend, tool.name, args);
  }

  // NPX tools — return a helpful message since they need local process
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

// ============================================================
// HONO SERVER
// ============================================================
const app = new Hono();

function authMiddleware(c: any, next: any) {
  const auth = c.req.header('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (token !== GATEWAY_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    gateway: 'GARZA OS Personal MCP Gateway',
    version: '1.0.0',
    stack: 'garza-tools',
    tools_count: toolRegistry.length,
    categories: [...new Set(toolRegistry.map(t => t.name.split('.')[0]))],
  });
});

let toolRegistry: ToolDef[] = [];

app.post('/mcp', authMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const { method, params, id } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'GARZA OS Personal MCP Gateway', version: '1.0.0' }
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

// Startup
loadCredentials().then(async () => {
  toolRegistry = await buildTools();
  console.log(`\n🔐 GARZA OS Personal MCP Gateway v1.0.0`);
  console.log(`📦 Stack: garza-tools (personal)`);
  console.log(`🛠  Tools: ${toolRegistry.length}`);
  const cats = [...new Set(toolRegistry.map(t => t.name.split('.')[0]))];
  for (const cat of cats) {
    const count = toolRegistry.filter(t => t.name.startsWith(cat + '.')).length;
    console.log(`   ${cat}: ${count} tools`);
  }
  console.log(`🚀 Listening on port ${PORT}\n`);
  serve({ fetch: app.fetch, port: PORT });
});
