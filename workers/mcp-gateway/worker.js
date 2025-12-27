// MCP Gateway v6 - Self-Modifying MCP Registry
const SUPABASE_URL = 'https://vbwhhmdudzigolwhklal.supabase.co';
const API_KEY = 'mcp-gateway-2025-garza';

async function supabase(env, path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { 
      'apikey': env.SUPABASE_KEY, 
      'Authorization': `Bearer ${env.SUPABASE_KEY}`, 
      'Content-Type': 'application/json', 
      'Prefer': options.prefer || 'return=representation',
      ...options.headers 
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function audit(env, action, details) {
  try { 
    await supabase(env, 'audit_log', { 
      method: 'POST', 
      body: JSON.stringify({ action, details, accessor: 'mcp-gateway' }) 
    }); 
  } catch (e) { console.error('Audit failed:', e); }
}

function buildUrl(base, key) {
  if (!key) return base;
  return `${base}${base.includes('?') ? '&' : '?'}key=${key}`;
}

const tools = {
  async list_mcps(env, args) {
    const query = args.enabled_only ? 'mcp_servers?enabled=eq.true&order=name' : 'mcp_servers?order=name';
    const mcps = await supabase(env, query);
    return { mcps: mcps.map(m => ({ name: m.name, url: m.url, enabled: m.enabled, description: m.description, health_status: m.health_status, priority: m.priority })), count: mcps.length };
  },
  async add_mcp(env, { name, url, description, auth_key, priority }) {
    if (!name || !url) throw new Error('name and url required');
    const existing = await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`);
    if (existing.length > 0) throw new Error(`MCP "${name}" exists. Use update_mcp.`);
    await supabase(env, 'mcp_servers', { method: 'POST', body: JSON.stringify({ name, url, description, auth_key, priority: priority || 100, enabled: true }) });
    await audit(env, 'add_mcp', { name, url });
    return { success: true, message: `Added: ${name}` };
  },
  async update_mcp(env, { name, url, description, auth_key, enabled, priority }) {
    if (!name) throw new Error('name required');
    const updates = {};
    if (url !== undefined) updates.url = url;
    if (description !== undefined) updates.description = description;
    if (auth_key !== undefined) updates.auth_key = auth_key;
    if (enabled !== undefined) updates.enabled = enabled;
    if (priority !== undefined) updates.priority = priority;
    if (Object.keys(updates).length === 0) throw new Error('No updates');
    await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(updates) });
    await audit(env, 'update_mcp', { name, updates });
    return { success: true, message: `Updated: ${name}` };
  },
  async remove_mcp(env, { name }) {
    if (!name) throw new Error('name required');
    await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
    await audit(env, 'remove_mcp', { name });
    return { success: true, message: `Removed: ${name}` };
  },
  async toggle_mcp(env, { name, enabled }) {
    if (!name) throw new Error('name required');
    const state = enabled !== false;
    await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ enabled: state }) });
    await audit(env, state ? 'enable_mcp' : 'disable_mcp', { name });
    return { success: true, message: `${state ? 'Enabled' : 'Disabled'}: ${name}` };
  },
  async test_mcp(env, { name }) {
    const mcps = await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`);
    if (mcps.length === 0) throw new Error(`Not found: ${name}`);
    const mcp = mcps[0];
    const testUrl = buildUrl(mcp.url, mcp.auth_key);
    const start = Date.now();
    try {
      const res = await fetch(testUrl);
      const latency = Date.now() - start;
      const status = res.ok || res.status === 200 ? 'healthy' : 'error';
      await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ health_status: status, last_health_check: new Date().toISOString() }) });
      return { name, url: mcp.url, status, http_status: res.status, latency_ms: latency };
    } catch (e) {
      await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ health_status: 'unreachable', last_health_check: new Date().toISOString() }) });
      return { name, url: mcp.url, status: 'unreachable', error: e.message, latency_ms: Date.now() - start };
    }
  },
  async test_all(env) {
    const mcps = await supabase(env, 'mcp_servers?enabled=eq.true&order=name');
    const results = [];
    for (const mcp of mcps) {
      const testUrl = buildUrl(mcp.url, mcp.auth_key);
      const start = Date.now();
      try {
        const res = await fetch(testUrl);
        const status = res.ok || res.status === 200 ? 'healthy' : 'error';
        await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(mcp.name)}`, { method: 'PATCH', body: JSON.stringify({ health_status: status, last_health_check: new Date().toISOString() }) });
        results.push({ name: mcp.name, status, latency_ms: Date.now() - start });
      } catch (e) {
        await supabase(env, `mcp_servers?name=eq.${encodeURIComponent(mcp.name)}`, { method: 'PATCH', body: JSON.stringify({ health_status: 'unreachable', last_health_check: new Date().toISOString() }) });
        results.push({ name: mcp.name, status: 'unreachable', error: e.message });
      }
    }
    return { results, healthy: results.filter(r => r.status === 'healthy').length, total: results.length };
  },
  async status(env) {
    const all = await supabase(env, 'mcp_servers?order=name');
    const enabled = all.filter(m => m.enabled);
    const healthy = all.filter(m => m.health_status === 'healthy');
    const logs = await supabase(env, 'audit_log?order=created_at.desc&limit=5');
    return { total_mcps: all.length, enabled_mcps: enabled.length, healthy_mcps: healthy.length, recent_actions: logs.map(l => ({ action: l.action, time: l.created_at })), version: 'v6' };
  },
  async get_logs(env, { limit = 20 }) {
    const logs = await supabase(env, `audit_log?order=created_at.desc&limit=${Math.min(limit, 100)}`);
    return { logs };
  },
  async generate_config(env) {
    const mcps = await supabase(env, 'mcp_servers?enabled=eq.true&order=priority,name');
    const config = { mcpServers: {} };
    for (const mcp of mcps) {
      config.mcpServers[mcp.name] = { url: buildUrl(mcp.url, mcp.auth_key) };
    }
    return { config, mcps: mcps.map(m => m.name), instruction: "Add mcpServers to Claude Desktop config" };
  }
};

const toolDefinitions = [
  { name: 'list_mcps', description: 'List all registered MCPs', inputSchema: { type: 'object', properties: { enabled_only: { type: 'boolean' } } } },
  { name: 'add_mcp', description: 'Add a new MCP', inputSchema: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' }, auth_key: { type: 'string' }, priority: { type: 'number' } }, required: ['name', 'url'] } },
  { name: 'update_mcp', description: 'Update an MCP', inputSchema: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' }, auth_key: { type: 'string' }, enabled: { type: 'boolean' }, priority: { type: 'number' } }, required: ['name'] } },
  { name: 'remove_mcp', description: 'Remove an MCP', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'toggle_mcp', description: 'Enable/disable an MCP', inputSchema: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['name'] } },
  { name: 'test_mcp', description: 'Test MCP connectivity', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'test_all', description: 'Test all enabled MCPs' },
  { name: 'status', description: 'Get gateway status' },
  { name: 'get_logs', description: 'Get audit logs', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'generate_config', description: 'Generate Claude Desktop MCP config' }
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (path === '/health') return new Response(JSON.stringify({ status: 'ok', version: 'v6', ts: new Date().toISOString() }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const apiKey = request.headers.get('X-API-Key') || url.searchParams.get('key');
    if (apiKey !== API_KEY) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    try {
      let result;
      if (path === '/tools') result = { tools: toolDefinitions };
      else if (path === '/call' && request.method === 'POST') {
        const body = await request.json();
        const toolName = body.name?.replace('gateway:', '');
        if (!tools[toolName]) throw new Error(`Unknown tool: ${body.name}`);
        result = await tools[toolName](env, body.arguments || {});
      }
      else if (path === '/sse') {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        (async () => { await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'ready' })}\n\n`)); setInterval(() => writer.write(encoder.encode(': ping\n\n')).catch(() => {}), 30000); })();
        return new Response(readable, { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
      }
      else return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
  }
};
