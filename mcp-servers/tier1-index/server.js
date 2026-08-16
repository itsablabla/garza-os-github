'use strict';
/* tier1-index — ONE-tool MCP: `list` → dynamically generated catalog of every
   tier-2 tool (Bifrost clients + gateway tools + direct endpoints).
   Regenerates from live registries on each call (5-min TTL cache); never empty. */
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PORT || 8080);
const BIFROST = 'https://llm.garzalabs.com';
const GATEWAY = 'https://mcp.garza.online';
const BIFROST_COOKIE = process.env.BIFROST_SESSION || '';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

let cache = { at: 0, markdown: '', stale: false };

const jreq = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const transport = url.startsWith('https') ? https : http;
  const data = body ? JSON.stringify(body) : null;
  const r = transport.request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
  }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

async function fetchBifrost() {
  const r = await jreq(BIFROST + '/api/mcp/clients?limit=100', { headers: { 'Cookie': BIFROST_COOKIE, 'Accept': 'application/json' } });
  if (r.status !== 200) throw new Error('bifrost ' + r.status);
  return JSON.parse(r.text).clients || [];
}

async function fetchGatewayTools() {
  // MCP handshake: initialize -> session id -> tools/list
  const init = await jreq(GATEWAY + '/mcp', { method: 'POST', body: {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tier1-index', version: '1.0.0' } },
  }, headers: { 'Authorization': 'Bearer ' + GATEWAY_TOKEN } });
  const sid = (init.text.match(/"mcp-session-id":"([^"]+)"/i) || [])[1]
    || (init.text.match(/Mcp-Session-Id:\s*([^\r\n]+)/i) || [])[1];
  const headers = { 'Authorization': 'Bearer ' + GATEWAY_TOKEN, 'Content-Type': 'application/json' };
  if (sid) headers['mcp-session-id'] = sid.trim();
  const tl = await jreq(GATEWAY + '/mcp', { method: 'POST', body: {
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
  }, headers });
  const names = [...tl.text.matchAll(/"name":"([a-z][a-z0-9_]*)"/g)].map(m => m[1]);
  return [...new Set(names)];
}

async function buildCatalog() {
  const now = new Date().toISOString();
  let lines = [];
  lines.push('# GARZA TIER-2 TOOL CATALOG');
  lines.push('');
  lines.push(`Generated: ${now} (tier1-index — regenerated live on every call)`);
  lines.push('');
  lines.push('## How to call tools');
  lines.push('');
  lines.push('1. **Bifrost code mode** (recommended): POST https://llm.garzalabs.com/v1/mcp/tool/execute?format=chat (no auth)');
  lines.push('   ```json');
  lines.push('   {"function":{"name":"executeToolCode","arguments":"{\\"code\\":\\"lark_mail.mail_v1_mailgroup_list(params={\\\\\\"page_size\\\\\\": 2})\\"}"}}');
  lines.push('   ```');
  lines.push('2. **Bifrost federated** (top-level MCP, key `llm-access-key`): tools like `Tavily-tavily_search` via https://llm.garzalabs.com/mcp');
  lines.push('3. **Gateway** (mcp.garza.online): `run` -> `call_tool` -> {name, params} for gateway tools below.');
  lines.push('4. **Direct MCP endpoints**: lark.garzalabs.com/<cat>/mcp (docs, mail, im, ...), drive.garzalabs.com/sse, beeperbox.garzalabs.com/mcp, e2b.garzalabs.com/mcp.');
  lines.push('');

  try {
    const clients = await fetchBifrost();
    lines.push(`## Bifrost clients (${clients.length})`);
    lines.push('');
    for (const c of clients.sort((a, b) => a.config.name.localeCompare(b.config.name))) {
      const cfg = c.config;
      const tools = (c.tools || []).map(t => t.name);
      lines.push(`### ${cfg.name} — ${c.state || 'unknown'}, ${tools.length} tools`);
      lines.push(`- MCP: ${cfg.connection_string && cfg.connection_string.value || 'n/a'}`);
      if (cfg.is_code_mode_client) lines.push(`- Code-mode key: \`${cfg.name}\` (use in executeToolCode, e.g. \`${cfg.name}.${tools[0] || '...'}(...)\`)`);
      lines.push(`- Tools (${tools.length}): ${tools.slice(0, 60).join(', ')}${tools.length > 60 ? ', ...' : ''}`);
      lines.push('');
    }
  } catch (e) {
    lines.push('## Bifrost clients — UNAVAILABLE (' + e.message + ')');
    lines.push('');
  }

  try {
    const gtools = await fetchGatewayTools();
    lines.push(`## Gateway tools (mcp.garza.online, ${gtools.length})`);
    lines.push('');
    lines.push(gtools.join(', '));
    lines.push('');
  } catch (e) {
    lines.push('## Gateway tools — UNAVAILABLE (' + e.message + ')');
    lines.push('');
  }

  lines.push('## Direct endpoints');
  lines.push('');
  lines.push('- lark.garzalabs.com/{admin,approval,docs,bitable,calendar,contact,drive,im,mail,task,vc,misc,acs,apaas,attendance,hr,hire}/mcp');
  lines.push('- beeperbox.garzalabs.com/mcp (Mac) · e2b.garzalabs.com/mcp · drive.garzalabs.com/sse (garza_drive) · tailscale-mcp.garzalabs.com/mcp');
  lines.push('- Kong: https://a68160fd9b.us.serverless.gateways.konggateway.com/mcp/<slug> (apikey auth)');
  lines.push('');
  return lines.join('\n');
}

async function getCatalog(force) {
  const now = Date.now();
  if (!force && cache.markdown && now - cache.at < 5 * 60 * 1000) {
    return { markdown: cache.markdown, stale: cache.stale, cached: true };
  }
  try {
    const md = await buildCatalog();
    cache = { at: now, markdown: md, stale: false };
    return { markdown: md, stale: false, cached: false };
  } catch (e) {
    if (cache.markdown) {
      cache.stale = true;
      return { markdown: cache.markdown, stale: true, cached: true, error: e.message };
    }
    return { markdown: '# Tier-2 catalog temporarily unavailable: ' + e.message, stale: true, cached: false };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok');
  }
  if (req.method === 'GET' && url.pathname === '/catalog.md') {
    const c = await getCatalog(false);
    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    return res.end(c.markdown + (c.stale ? '\n\n_STALE_ ' + (c.error || '') : ''));
  }
  if (req.method !== 'POST' || !(url.pathname === '/mcp' || url.pathname === '/mcp/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found');
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { msg = {}; }
    let result;
    if (msg.method === 'initialize') {
      result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'tier1-index', version: '1.0.0' } };
    } else if (msg.method === 'tools/list') {
      result = { tools: [{ name: 'list', description: 'Return the live catalog of every tier-2 tool (Bifrost clients, gateway tools, direct endpoints) as markdown. Regenerated from the registries on each call (5-min cache).' }] };
    } else if (msg.method === 'tools/call') {
      const force = !!(msg.params && msg.params.arguments && (msg.params.arguments.force || msg.params.arguments.force === 'true'));
      const c = await getCatalog(force);
      const text = c.markdown + (c.stale ? '\n\n_STALE_' + (c.error ? ' ' + c.error : '') : '');
      result = { content: [{ type: 'text', text }] };
    } else {
      result = {};
    }
    const out = 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n\n';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(out) });
    res.end(out);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('tier1-index MCP listening on :' + PORT));
