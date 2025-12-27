// Garza Cloud MCP v3.3 - with UniFi Protect + Beeper
// Cloudflare Worker with KV, R2, D1, UniFi Protect, and Beeper tools

interface Env {
  KV: KVNamespace;
  DB: D1Database;
  STORAGE: R2Bucket;
  API_KEY: string;
  ADMIN_KEY: string;
  PROTECT_URL: string;
  BEEPER_PROXY_URL: string;
  BEEPER_TOKEN: string;
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateId(): string {
  return crypto.randomUUID();
}

async function checkRateLimit(env: Env, keyId: string, limit: number): Promise<boolean> {
  const key = `rate:${keyId}:${Math.floor(Date.now() / 60000)}`;
  const current = parseInt(await env.KV.get(key) || '0');
  if (current >= limit) return false;
  await env.KV.put(key, String(current + 1), { expirationTtl: 120 });
  return true;
}

async function logAudit(env: Env, data: any): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO audit_logs (api_key_id, tool_name, input_params, result, duration_ms, status, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.api_key_id || null,
    data.tool_name || null,
    data.input_params || null,
    data.result || null,
    data.duration_ms || null,
    data.status,
    data.ip_address || null,
    data.user_agent || null
  ).run();
}

async function protectFetch(env: Env, path: string): Promise<any> {
  const url = `${env.PROTECT_URL || 'https://protect.garzahive.com'}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Protect API error: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    return { json: await response.json(), buffer: null };
  } else {
    return { json: null, buffer: await response.arrayBuffer() };
  }
}

// Beeper API proxy helper
async function beeperFetch(env: Env, endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  const baseUrl = env.BEEPER_PROXY_URL || 'http://localhost:23373';
  const url = `${baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.BEEPER_TOKEN}`,
    'Content-Type': 'application/json'
  };
  
  const options: RequestInit = { method, headers };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Beeper API error ${response.status}: ${text}`);
  }
  return await response.json();
}

const BUILTIN_TOOLS: Record<string, (params: any, env: Env) => Promise<any>> = {
  async ping() {
    return { pong: true, timestamp: new Date().toISOString(), server: 'garza-cloud-mcp', version: '3.3' };
  },

  async list_tools(params: any, env: Env) {
    const tools = await env.DB.prepare('SELECT id, name, description, enabled FROM tools WHERE enabled = 1').all();
    return { tools: tools.results, builtin: Object.keys(BUILTIN_TOOLS) };
  },

  async get_tool(params: any, env: Env) {
    const { name } = params;
    const tool = await env.DB.prepare('SELECT * FROM tools WHERE name = ?').bind(name).first();
    return tool || { error: 'Tool not found' };
  },

  async system_info() {
    return {
      server: 'Garza Cloud MCP',
      version: '3.3',
      runtime: 'Cloudflare Workers',
      timestamp: new Date().toISOString(),
      capabilities: ['d1', 'kv', 'r2', 'webhooks', 'dynamic-tools', 'audit-logging', 'unifi-protect', 'beeper']
    };
  },

  async kv_get(params: any, env: Env) {
    const { key } = params;
    const value = await env.KV.get(key);
    return { key, value };
  },

  async kv_set(params: any, env: Env) {
    const { key, value, ttl } = params;
    await env.KV.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
    return { success: true, key };
  },

  async kv_delete(params: any, env: Env) {
    const { key } = params;
    await env.KV.delete(key);
    return { success: true, key };
  },

  async kv_list(params: any, env: Env) {
    const { prefix, limit } = params;
    const list = await env.KV.list({ prefix, limit: limit || 100 });
    return { keys: list.keys.map(k => k.name), cursor: list.cursor };
  },

  async r2_list(params: any, env: Env) {
    const { prefix, limit } = params;
    const list = await env.STORAGE.list({ prefix, limit: limit || 100 });
    return { objects: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })) };
  },

  async r2_get(params: any, env: Env) {
    const { key } = params;
    const obj = await env.STORAGE.get(key);
    if (!obj) return { error: 'Object not found' };
    const text = await obj.text();
    return { key, size: obj.size, data: text.length > 10000 ? text.slice(0, 10000) + '...' : text };
  },

  async r2_put(params: any, env: Env) {
    const { key, data, contentType } = params;
    await env.STORAGE.put(key, data, { httpMetadata: { contentType: contentType || 'text/plain' } });
    return { success: true, key };
  },

  async r2_delete(params: any, env: Env) {
    const { key } = params;
    await env.STORAGE.delete(key);
    return { success: true, key };
  },

  async db_query(params: any, env: Env) {
    const { sql, bindings } = params;
    const stmt = env.DB.prepare(sql);
    const result = bindings ? await stmt.bind(...bindings).all() : await stmt.all();
    return { results: result.results, meta: result.meta };
  },

  async get_audit_logs(params: any, env: Env) {
    const { limit, tool_name, status } = params;
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const bindings: any[] = [];
    if (tool_name) { query += ' AND tool_name = ?'; bindings.push(tool_name); }
    if (status) { query += ' AND status = ?'; bindings.push(status); }
    query += ' ORDER BY timestamp DESC LIMIT ?';
    bindings.push(limit || 50);
    const result = await env.DB.prepare(query).bind(...bindings).all();
    return { logs: result.results };
  },

  async webhook_call(params: any, env: Env) {
    const { url, method, headers, body } = params;
    const response = await fetch(url, {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    try {
      return { status: response.status, data: JSON.parse(text) };
    } catch {
      return { status: response.status, data: text };
    }
  },

  // ========== UniFi Protect Tools ==========
  async protect_list_cameras(params: any, env: Env) {
    const { json } = await protectFetch(env, '/cameras');
    return { cameras: json, count: json.length, timestamp: new Date().toISOString() };
  },

  async protect_get_camera(params: any, env: Env) {
    const { camera_id, camera_name } = params;
    const { json: cameras } = await protectFetch(env, '/cameras');
    let camera;
    if (camera_id) {
      camera = cameras.find((c: any) => c.id === camera_id);
    } else if (camera_name) {
      camera = cameras.find((c: any) => c.name.toLowerCase().includes(camera_name.toLowerCase()));
    }
    if (!camera) {
      return { error: 'Camera not found', available: cameras.map((c: any) => c.name) };
    }
    return camera;
  },

  async protect_snapshot(params: any, env: Env) {
    const { camera_id, camera_name } = params;
    let resolvedId = camera_id;
    if (!resolvedId && camera_name) {
      const { json: cameras } = await protectFetch(env, '/cameras');
      const camera = cameras.find((c: any) => c.name.toLowerCase().includes(camera_name.toLowerCase()));
      if (!camera) { return { error: 'Camera not found' }; }
      resolvedId = camera.id;
    }
    const { buffer } = await protectFetch(env, `/snapshot/${resolvedId}`);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return { camera_id: resolvedId, image_base64: base64, content_type: 'image/jpeg', timestamp: new Date().toISOString() };
  },

  async protect_events(params: any, env: Env) {
    const { limit, camera_name } = params;
    const { json: events } = await protectFetch(env, `/events?limit=${limit || 20}`);
    let filtered = events;
    if (camera_name) {
      const { json: cameras } = await protectFetch(env, '/cameras');
      const camera = cameras.find((c: any) => c.name.toLowerCase().includes(camera_name.toLowerCase()));
      if (camera) { filtered = events.filter((e: any) => e.camera === camera.id); }
    }
    return { events: filtered, count: filtered.length, timestamp: new Date().toISOString() };
  },

  async protect_check_motion(params: any, env: Env) {
    const { camera_name, minutes } = params;
    const { json: cameras } = await protectFetch(env, '/cameras');
    const cutoff = Date.now() - ((minutes || 30) * 60 * 1000);
    let results: any[] = [];
    for (const cam of cameras) {
      if (camera_name && !cam.name.toLowerCase().includes(camera_name.toLowerCase())) { continue; }
      const hasRecentMotion = cam.lastMotion && new Date(cam.lastMotion).getTime() > cutoff;
      results.push({ name: cam.name, id: cam.id, hasRecentMotion, lastMotion: cam.lastMotion });
    }
    return { cameras: results, anyMotion: results.some(r => r.hasRecentMotion), checkedMinutes: minutes || 30, timestamp: new Date().toISOString() };
  },

  async protect_health(params: any, env: Env) {
    try {
      const { json } = await protectFetch(env, '/health');
      return { ...json, reachable: true };
    } catch (e: any) {
      return { reachable: false, error: e.message };
    }
  },

  // ========== Beeper Tools ==========
  async beeper_search(params: any, env: Env) {
    const { query } = params;
    return await beeperFetch(env, `/v1/search?query=${encodeURIComponent(query)}`);
  },

  async beeper_search_chats(params: any, env: Env) {
    const { query, scope, inbox, type, unreadOnly, limit, includeMuted } = params;
    const searchParams = new URLSearchParams();
    if (query) searchParams.set('query', query);
    if (scope) searchParams.set('scope', scope);
    if (inbox) searchParams.set('inbox', inbox);
    if (type) searchParams.set('type', type);
    if (unreadOnly !== undefined) searchParams.set('unreadOnly', String(unreadOnly));
    if (limit) searchParams.set('limit', String(limit));
    if (includeMuted !== undefined) searchParams.set('includeMuted', String(includeMuted));
    return await beeperFetch(env, `/v1/chats/search?${searchParams.toString()}`);
  },

  async beeper_search_messages(params: any, env: Env) {
    const { query, chatIDs, chatType, sender, dateAfter, dateBefore, mediaTypes, limit } = params;
    const searchParams = new URLSearchParams();
    if (query) searchParams.set('query', query);
    if (chatIDs) searchParams.set('chatIDs', chatIDs.join(','));
    if (chatType) searchParams.set('chatType', chatType);
    if (sender) searchParams.set('sender', sender);
    if (dateAfter) searchParams.set('dateAfter', dateAfter);
    if (dateBefore) searchParams.set('dateBefore', dateBefore);
    if (mediaTypes) searchParams.set('mediaTypes', mediaTypes.join(','));
    if (limit) searchParams.set('limit', String(limit));
    return await beeperFetch(env, `/v1/messages/search?${searchParams.toString()}`);
  },

  async beeper_get_chat(params: any, env: Env) {
    const { chatID, maxParticipantCount } = params;
    const searchParams = new URLSearchParams();
    if (maxParticipantCount !== undefined) searchParams.set('maxParticipantCount', String(maxParticipantCount));
    return await beeperFetch(env, `/v1/chats/${encodeURIComponent(chatID)}?${searchParams.toString()}`);
  },

  async beeper_get_accounts(params: any, env: Env) {
    return await beeperFetch(env, '/v1/accounts');
  },

  async beeper_list_messages(params: any, env: Env) {
    const { chatID, cursor, direction } = params;
    const searchParams = new URLSearchParams();
    if (cursor) searchParams.set('cursor', cursor);
    if (direction) searchParams.set('direction', direction);
    return await beeperFetch(env, `/v1/chats/${encodeURIComponent(chatID)}/messages?${searchParams.toString()}`);
  },

  async beeper_archive_chat(params: any, env: Env) {
    const { chatID, archived } = params;
    return await beeperFetch(env, `/v1/chats/${encodeURIComponent(chatID)}/archive`, 'POST', { archived: archived !== false });
  },

  async beeper_send_message(params: any, env: Env) {
    const { chatID, text, replyToMessageID } = params;
    const body: any = { text };
    if (replyToMessageID) body.replyToMessageID = replyToMessageID;
    return await beeperFetch(env, `/v1/chats/${encodeURIComponent(chatID)}/messages`, 'POST', body);
  },

  async beeper_set_chat_reminder(params: any, env: Env) {
    const { chatID, remindAtMs, dismissOnIncomingMessage } = params;
    return await beeperFetch(env, `/v1/chats/${encodeURIComponent(chatID)}/reminder`, 'POST', {
      remindAtMs,
      dismissOnIncomingMessage: dismissOnIncomingMessage !== false
    });
  },

  async beeper_clear_chat_reminder(params: any, env: Env) {
    const { chatID } = params;
    return await beeperFetch(env, `/v1/chats/${encodeURIComponent(chatID)}/reminder`, 'DELETE');
  },

  async beeper_focus_app(params: any, env: Env) {
    const { chatID, messageID, draftText } = params;
    const body: any = {};
    if (chatID) body.chatID = chatID;
    if (messageID) body.messageID = messageID;
    if (draftText) body.draftText = draftText;
    return await beeperFetch(env, '/v1/focus', 'POST', body);
  }
};

const BUILTIN_SCHEMAS: Record<string, any> = {
  ping: { type: 'object', properties: {}, required: [] },
  list_tools: { type: 'object', properties: {}, required: [] },
  get_tool: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  system_info: { type: 'object', properties: {}, required: [] },
  kv_get: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  kv_set: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, ttl: { type: 'number' } }, required: ['key', 'value'] },
  kv_delete: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  kv_list: { type: 'object', properties: { prefix: { type: 'string' }, limit: { type: 'number' } }, required: [] },
  r2_list: { type: 'object', properties: { prefix: { type: 'string' }, limit: { type: 'number' } }, required: [] },
  r2_get: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  r2_put: { type: 'object', properties: { key: { type: 'string' }, data: { type: 'string' }, contentType: { type: 'string' } }, required: ['key', 'data'] },
  r2_delete: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  db_query: { type: 'object', properties: { sql: { type: 'string' }, bindings: { type: 'array' } }, required: ['sql'] },
  get_audit_logs: { type: 'object', properties: { limit: { type: 'number' }, tool_name: { type: 'string' }, status: { type: 'string' } }, required: [] },
  webhook_call: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object' }, body: { type: 'object' } }, required: ['url'] },
  // Protect schemas
  protect_list_cameras: { type: 'object', properties: {}, required: [], description: 'List all UniFi Protect cameras with status' },
  protect_get_camera: { type: 'object', properties: { camera_id: { type: 'string' }, camera_name: { type: 'string' } }, required: [], description: 'Get camera by ID or name' },
  protect_snapshot: { type: 'object', properties: { camera_id: { type: 'string' }, camera_name: { type: 'string' } }, required: [], description: 'Get live snapshot (base64 JPEG)' },
  protect_events: { type: 'object', properties: { limit: { type: 'number' }, camera_name: { type: 'string' } }, required: [], description: 'Get recent motion events' },
  protect_check_motion: { type: 'object', properties: { camera_name: { type: 'string' }, minutes: { type: 'number' } }, required: [], description: 'Check recent motion' },
  protect_health: { type: 'object', properties: {}, required: [], description: 'Check Protect system health' },
  // Beeper schemas
  beeper_search: { type: 'object', properties: { query: { type: 'string', description: 'Search text (literal word matching)' } }, required: ['query'], description: 'Search chats, participants, and messages' },
  beeper_search_chats: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['titles', 'participants'] }, inbox: { type: 'string', enum: ['primary', 'low-priority', 'archive'] }, type: { type: 'string', enum: ['single', 'group', 'any'] }, unreadOnly: { type: 'boolean' }, limit: { type: 'number' }, includeMuted: { type: 'boolean' } }, required: [], description: 'Search chats by title/network or participants' },
  beeper_search_messages: { type: 'object', properties: { query: { type: 'string' }, chatIDs: { type: 'array', items: { type: 'string' } }, chatType: { type: 'string', enum: ['group', 'single'] }, sender: { type: 'string' }, dateAfter: { type: 'string' }, dateBefore: { type: 'string' }, mediaTypes: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } }, required: [], description: 'Search messages across chats' },
  beeper_get_chat: { type: 'object', properties: { chatID: { type: 'string' }, maxParticipantCount: { type: 'number' } }, required: ['chatID'], description: 'Get chat details: metadata, participants, last activity' },
  beeper_get_accounts: { type: 'object', properties: {}, required: [], description: 'List connected messaging accounts' },
  beeper_list_messages: { type: 'object', properties: { chatID: { type: 'string' }, cursor: { type: 'string' }, direction: { type: 'string', enum: ['after', 'before'] } }, required: ['chatID'], description: 'List messages from a chat with pagination' },
  beeper_archive_chat: { type: 'object', properties: { chatID: { type: 'string' }, archived: { type: 'boolean' } }, required: ['chatID'], description: 'Archive or unarchive a chat' },
  beeper_send_message: { type: 'object', properties: { chatID: { type: 'string' }, text: { type: 'string' }, replyToMessageID: { type: 'string' } }, required: ['chatID', 'text'], description: 'Send a text message to a chat' },
  beeper_set_chat_reminder: { type: 'object', properties: { chatID: { type: 'string' }, remindAtMs: { type: 'number' }, dismissOnIncomingMessage: { type: 'boolean' } }, required: ['chatID', 'remindAtMs'], description: 'Set a reminder for a chat' },
  beeper_clear_chat_reminder: { type: 'object', properties: { chatID: { type: 'string' } }, required: ['chatID'], description: 'Clear a chat reminder' },
  beeper_focus_app: { type: 'object', properties: { chatID: { type: 'string' }, messageID: { type: 'string' }, draftText: { type: 'string' } }, required: [], description: 'Focus Beeper Desktop and optionally navigate to chat' }
};

async function executeDynamicTool(tool: any, params: any, env: Env): Promise<any> {
  const config = tool.handler_config ? JSON.parse(tool.handler_config) : {};
  if (tool.handler_type === 'webhook' && config.url) {
    const response = await fetch(config.url, { method: config.method || 'POST', headers: { 'Content-Type': 'application/json', ...config.headers }, body: JSON.stringify({ tool: tool.name, params }) });
    return await response.json();
  }
  if (tool.handler_type === 'javascript' && config.code) {
    const fn = new Function('params', 'env', config.code);
    return await fn(params, { kv: env.KV, db: env.DB, r2: env.STORAGE });
  }
  if (tool.handler_type === 'http' && config.url) {
    const url = new URL(config.url);
    for (const [key, value] of Object.entries(params)) { url.searchParams.set(key, String(value)); }
    const response = await fetch(url.toString(), { method: config.method || 'GET', headers: config.headers || {} });
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { response: text }; }
  }
  return { error: 'Unknown handler type' };
}

async function handleMCPRequest(request: any, env: Env, apiKeyId?: string): Promise<any> {
  const { method, params, id } = request;
  const startTime = Date.now();
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'Garza Cloud MCP', version: '3.3' } };
        break;
      case 'tools/list':
        const dbTools = await env.DB.prepare('SELECT name, description, input_schema FROM tools WHERE enabled = 1').all();
        const tools = [
          ...Object.entries(BUILTIN_SCHEMAS).map(([name, schema]) => ({ name, description: (schema as any).description || `Built-in: ${name}`, inputSchema: schema })),
          ...dbTools.results.map((t: any) => ({ name: t.name, description: t.description, inputSchema: JSON.parse(t.input_schema) }))
        ];
        result = { tools };
        break;
      case 'tools/call':
        const toolName = params?.name;
        const toolParams = params?.arguments || {};
        if (BUILTIN_TOOLS[toolName]) {
          result = await BUILTIN_TOOLS[toolName](toolParams, env);
        } else {
          const dbTool = await env.DB.prepare('SELECT * FROM tools WHERE name = ? AND enabled = 1').bind(toolName).first();
          if (dbTool) { result = await executeDynamicTool(dbTool, toolParams, env); }
          else { throw new Error(`Tool not found: ${toolName}`); }
        }
        await logAudit(env, { api_key_id: apiKeyId, tool_name: toolName, input_params: JSON.stringify(toolParams), result: JSON.stringify(result).slice(0, 5000), duration_ms: Date.now() - startTime, status: 'success' });
        result = { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        break;
      case 'notifications/initialized':
      case 'ping':
        result = {};
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await logAudit(env, { api_key_id: apiKeyId, tool_name: params?.name, status: 'error', result: message, duration_ms: Date.now() - startTime });
    return { jsonrpc: '2.0', id, error: { code: -32000, message } };
  }
}

async function handleAdminRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/admin', '');
  const adminKey = request.headers.get('X-Admin-Key');
  if (adminKey !== env.ADMIN_KEY) { return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }); }
  if (request.method === 'GET' && path === '/tools') {
    const tools = await env.DB.prepare('SELECT * FROM tools').all();
    return Response.json({ tools: tools.results });
  }
  if (request.method === 'POST' && path === '/tools') {
    const body: any = await request.json();
    await env.DB.prepare('INSERT INTO tools (name, description, input_schema, handler_type, handler_config, enabled) VALUES (?, ?, ?, ?, ?, ?)').bind(body.name, body.description, JSON.stringify(body.input_schema), body.handler_type || 'internal', JSON.stringify(body.handler_config || {}), 1).run();
    return Response.json({ success: true });
  }
  if (request.method === 'DELETE' && path.startsWith('/tools/')) {
    const toolId = path.replace('/tools/', '');
    await env.DB.prepare('DELETE FROM tools WHERE id = ?').bind(toolId).run();
    return Response.json({ success: true });
  }
  if (request.method === 'GET' && path === '/keys') {
    const keys = await env.DB.prepare('SELECT id, name, permissions, rate_limit, enabled, created_at, last_used_at FROM api_keys').all();
    return Response.json({ keys: keys.results });
  }
  if (request.method === 'POST' && path === '/keys') {
    const body: any = await request.json();
    const rawKey = `gcm_${generateId().replace(/-/g, '')}`;
    const keyHash = await hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 8);
    await env.DB.prepare('INSERT INTO api_keys (key_hash, key_prefix, name, permissions, rate_limit, enabled) VALUES (?, ?, ?, ?, ?, ?)').bind(keyHash, keyPrefix, body.name, JSON.stringify(body.permissions || ['*']), body.rate_limit || 100, 1).run();
    return Response.json({ success: true, key: rawKey, prefix: keyPrefix });
  }
  if (request.method === 'DELETE' && path.startsWith('/keys/')) {
    const keyId = path.replace('/keys/', '');
    await env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(keyId).run();
    return Response.json({ success: true });
  }
  if (request.method === 'GET' && path === '/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const logs = await env.DB.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').bind(limit).all();
    return Response.json({ logs: logs.results });
  }
  if (request.method === 'GET' && path === '/stats') {
    const totalCalls = await env.DB.prepare('SELECT COUNT(*) as count FROM audit_logs').first();
    const todayCalls = await env.DB.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE timestamp > datetime('now', '-1 day')").first();
    const toolUsage = await env.DB.prepare('SELECT tool_name, COUNT(*) as count FROM audit_logs GROUP BY tool_name ORDER BY count DESC LIMIT 10').all();
    const errorRate = await env.DB.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE status = 'error'").first();
    return Response.json({ totalCalls: (totalCalls as any)?.count || 0, todayCalls: (todayCalls as any)?.count || 0, errorCount: (errorRate as any)?.count || 0, topTools: toolUsage.results });
  }
  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

async function handleSSE(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session') || generateId();
  const apiKey = request.headers.get('X-API-Key') || url.searchParams.get('key');
  let apiKeyId: string | undefined;
  if (apiKey && apiKey !== env.API_KEY) {
    const keyHash = await hashKey(apiKey);
    const dbKey: any = await env.DB.prepare('SELECT id, rate_limit, enabled FROM api_keys WHERE key_hash = ?').bind(keyHash).first();
    if (!dbKey || !dbKey.enabled) { return new Response('Unauthorized', { status: 401 }); }
    if (!await checkRateLimit(env, String(dbKey.id), dbKey.rate_limit)) { return new Response('Rate limit exceeded', { status: 429 }); }
    apiKeyId = String(dbKey.id);
    await env.DB.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").bind(dbKey.id).run();
  }
  await env.KV.put(`session:${sessionId}`, JSON.stringify({ created: Date.now(), apiKeyId }), { expirationTtl: 3600 });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  writer.write(encoder.encode(`event: endpoint\ndata: /mcp/message?session=${sessionId}\n\n`));
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' } });
}

async function handleMessage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  if (!sessionId) { return new Response(JSON.stringify({ error: 'Session required' }), { status: 400 }); }
  const session = await env.KV.get(`session:${sessionId}`);
  if (!session) { return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 }); }
  const sessionData = JSON.parse(session);
  const body = await request.json();
  const response = await handleMCPRequest(body, env, sessionData.apiKeyId);
  return Response.json(response, { headers: { 'Access-Control-Allow-Origin': '*' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Admin-Key' } });
    }
    if (path === '/health') { return Response.json({ status: 'healthy', version: '3.3', timestamp: new Date().toISOString() }); }
    if (path.startsWith('/admin')) { return handleAdminRequest(request, env); }
    if (path === '/sse' || path === '/mcp') { return handleSSE(request, env); }
    if (path === '/mcp/message') { return handleMessage(request, env); }
    if (path === '/call' && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (apiKey !== env.API_KEY) { return new Response('Unauthorized', { status: 401 }); }
      const body: any = await request.json();
      if (BUILTIN_TOOLS[body.tool]) {
        const result = await BUILTIN_TOOLS[body.tool](body.params || {}, env);
        return Response.json(result);
      }
      return Response.json({ error: 'Tool not found' }, { status: 404 });
    }
    if (path === '/') {
      return Response.json({ 
        server: 'Garza Cloud MCP', 
        version: '3.3', 
        endpoints: { mcp: '/sse or /mcp', admin: '/admin/*', health: '/health', directCall: '/call' }, 
        protect: { tools: ['protect_list_cameras', 'protect_get_camera', 'protect_snapshot', 'protect_events', 'protect_check_motion', 'protect_health'] },
        beeper: { tools: ['beeper_search', 'beeper_search_chats', 'beeper_search_messages', 'beeper_get_chat', 'beeper_get_accounts', 'beeper_list_messages', 'beeper_archive_chat', 'beeper_send_message', 'beeper_set_chat_reminder', 'beeper_clear_chat_reminder', 'beeper_focus_app'] }
      });
    }
    return new Response('Not found', { status: 404 });
  }
};
