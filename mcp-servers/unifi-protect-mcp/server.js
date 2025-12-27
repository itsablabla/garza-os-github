#!/usr/bin/env node
// UniFi Protect MCP Server v5.4.1 - Verbose logging

const http = require('http');
const https = require('https');
const fs = require('fs');

const LOG = '/Users/customer/unifi-protect-mcp/access.log';
function log(msg) { const ts = new Date().toISOString(); fs.appendFileSync(LOG, `${ts} ${msg}\n`); console.log(`${ts} ${msg}`); }

const CONFIG = { unvr_host: "192.168.10.49", server_port: 3849, api_key: "unifi-protect-2024-garza" };
const PORT = CONFIG.server_port;
const VERSION = "5.4.1";

let authToken = null, cookies = [];
const sessions = new Map();

function apiRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: CONFIG.unvr_host, port: 443, path,
      method: options.method || 'GET', rejectUnauthorized: false,
      headers: { 'Accept': 'application/json', 'Cookie': cookies.join('; '), ...(authToken && { 'X-CSRF-Token': authToken }), ...options.headers }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: CONFIG.unvr_host, port: 443, path: '/api/auth/login', method: 'POST',
      rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' }
    }, res => {
      cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
      authToken = res.headers['x-csrf-token'];
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ username: 'Jaden', password: '2kqc5fs-7JDgduMlLJ3z436YGaR16tnO', rememberMe: true }));
    req.end();
  });
}

async function ensureAuth() { if (!authToken) await authenticate(); }

async function getSnapshot(cameraId, width = 640) {
  await ensureAuth();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: CONFIG.unvr_host, port: 443, path: `/proxy/protect/api/cameras/${cameraId}/snapshot?w=${width}`,
      method: 'GET', rejectUnauthorized: false, headers: { 'Cookie': cookies.join('; ') }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    });
    req.on('error', reject);
    req.end();
  });
}

const TOOLS = [
  { name: 'get_system_info', description: 'Get UniFi Protect system information and version', inputSchema: { type: 'object', properties: {} } },
  { name: 'health_check', description: 'Check UniFi Protect connection health', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_cameras', description: 'List all cameras with their status, names, and IDs', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_camera', description: 'Get detailed info about a specific camera', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' } }, required: ['camera_id'] } },
  { name: 'get_snapshot', description: 'Get camera snapshot as base64 image data. Returns actual image, not just URL.', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' }, width: { type: 'number', description: 'Image width (default 640)' } }, required: ['camera_id'] } },
  { name: 'get_events', description: 'Get recent motion/detection events from cameras', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max events to return (default 20)' }, minutes_ago: { type: 'number', description: 'Get events from last N minutes' }, cameras: { type: 'array', items: { type: 'string' }, description: 'Filter by camera IDs' }, types: { type: 'array', items: { type: 'string' }, description: 'Event types: motion, smartDetectZone, ring' } } } },
  { name: 'set_camera_led', description: 'Turn camera status LED on or off', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' }, enabled: { type: 'boolean', description: 'LED enabled state' } }, required: ['camera_id', 'enabled'] } },
  { name: 'set_camera_mic', description: 'Enable or disable camera microphone', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' }, enabled: { type: 'boolean', description: 'Mic enabled state' } }, required: ['camera_id', 'enabled'] } },
  { name: 'set_lcd_message', description: 'Set LCD message on doorbell cameras', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' }, message: { type: 'string', description: 'Message text (max 30 chars)' }, duration: { type: 'number', description: 'Duration in ms (0=indefinite)' } }, required: ['camera_id', 'message'] } },
  { name: 'ptz_move', description: 'Move PTZ camera (pan/tilt/zoom)', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' }, pan: { type: 'number', description: 'Pan speed (-100 to 100)' }, tilt: { type: 'number', description: 'Tilt speed (-100 to 100)' }, zoom: { type: 'number', description: 'Zoom speed (-100 to 100)' } }, required: ['camera_id'] } },
  { name: 'ptz_goto_preset', description: 'Move PTZ camera to a preset position', inputSchema: { type: 'object', properties: { camera_id: { type: 'string', description: 'Camera ID' }, slot: { type: 'number', description: 'Preset slot number (-1 for home)' } }, required: ['camera_id', 'slot'] } },
  { name: 'list_sensors', description: 'List all sensors (door/window, motion, etc)', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_lights', description: 'List all smart lights', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_light', description: 'Control a smart light', inputSchema: { type: 'object', properties: { light_id: { type: 'string', description: 'Light ID' }, on: { type: 'boolean', description: 'Light on/off' }, brightness: { type: 'number', description: 'Brightness 0-100' } }, required: ['light_id'] } },
  { name: 'list_chimes', description: 'List all doorbell chimes', inputSchema: { type: 'object', properties: {} } },
  { name: 'play_chime', description: 'Play a sound on a chime', inputSchema: { type: 'object', properties: { chime_id: { type: 'string', description: 'Chime ID' }, volume: { type: 'number', description: 'Volume 0-100' } }, required: ['chime_id'] } },
  { name: 'list_viewers', description: 'List all Viewport devices', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_liveviews', description: 'List all configured liveviews', inputSchema: { type: 'object', properties: {} } }
];

async function executeTool(name, args) {
  await ensureAuth();
  switch(name) {
    case 'health_check': return { status: 'healthy', version: VERSION, timestamp: new Date().toISOString() };
    case 'get_system_info': const b = await apiRequest('/proxy/protect/api/bootstrap'); return { version: b.nvr?.version, uptime: b.nvr?.uptime, cameras: b.cameras?.length, host: b.nvr?.host };
    case 'list_cameras': const bc = await apiRequest('/proxy/protect/api/bootstrap'); return bc.cameras?.map(c => ({ id: c.id, name: c.name, type: c.type, state: c.state, isConnected: c.isConnected })) || [];
    case 'get_camera': return apiRequest(`/proxy/protect/api/cameras/${args.camera_id}`);
    case 'get_snapshot': return { camera_id: args.camera_id, image: `data:image/jpeg;base64,${await getSnapshot(args.camera_id, args.width||640)}` };
    case 'get_events': const mins = args.minutes_ago || 60; const end = Date.now(); const start = end - mins*60*1000; return apiRequest(`/proxy/protect/api/events?start=${start}&end=${end}&limit=${args.limit||20}`);
    case 'set_camera_led': return apiRequest(`/proxy/protect/api/cameras/${args.camera_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ledSettings: { isEnabled: args.enabled } }) });
    case 'set_camera_mic': return apiRequest(`/proxy/protect/api/cameras/${args.camera_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isMicEnabled: args.enabled }) });
    case 'set_lcd_message': return apiRequest(`/proxy/protect/api/cameras/${args.camera_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lcdMessage: { type: 'CUSTOM_MESSAGE', text: args.message, resetAt: args.duration ? Date.now()+args.duration : null } }) });
    case 'ptz_move': return apiRequest(`/proxy/protect/api/cameras/${args.camera_id}/ptz/relative`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pan: args.pan||0, tilt: args.tilt||0, zoom: args.zoom||0 }) });
    case 'ptz_goto_preset': return apiRequest(`/proxy/protect/api/cameras/${args.camera_id}/ptz/goto/${args.slot}`, { method: 'POST' });
    case 'list_sensors': const bs = await apiRequest('/proxy/protect/api/bootstrap'); return bs.sensors || [];
    case 'list_lights': const bl = await apiRequest('/proxy/protect/api/bootstrap'); return bl.lights || [];
    case 'set_light': return apiRequest(`/proxy/protect/api/lights/${args.light_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isLightOn: args.on, lightDeviceSettings: args.brightness !== undefined ? { ledLevel: args.brightness } : undefined }) });
    case 'list_chimes': const bch = await apiRequest('/proxy/protect/api/bootstrap'); return bch.chimes || [];
    case 'play_chime': return apiRequest(`/proxy/protect/api/chimes/${args.chime_id}/play-speaker`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume: args.volume || 100 }) });
    case 'list_viewers': const bv = await apiRequest('/proxy/protect/api/bootstrap'); return bv.viewers || [];
    case 'list_liveviews': const blv = await apiRequest('/proxy/protect/api/bootstrap'); return blv.liveviews || [];
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  log(`${req.method} ${path} from ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
  
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  
  if (path === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'healthy', version: VERSION }));
  }
  
  if (path === '/sse' && req.method === 'GET') {
    const key = url.searchParams.get('key');
    if (key !== CONFIG.api_key) {
      res.writeHead(401, cors);
      return res.end('Unauthorized');
    }
    
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { created: Date.now() });
    log(`SSE: Created session ${sessionId}, total: ${sessions.size}`);
    
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event: endpoint\ndata: /mcp/message?session=${sessionId}\n\n`);
    
    const keepalive = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(keepalive); sessions.delete(sessionId); log(`SSE: Session ${sessionId} closed, remaining: ${sessions.size}`); });
    return;
  }
  
  if (path === '/mcp/message' && req.method === 'POST') {
    const sessionId = url.searchParams.get('session');
    const valid = sessions.has(sessionId);
    log(`MESSAGE: session=${sessionId}, valid=${valid}`);
    
    if (!valid) {
      res.writeHead(401, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid session' }));
    }
    
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      // LOG THE FULL REQUEST BODY
      log(`BODY: ${body}`);
      
      try {
        const parsed = JSON.parse(body);
        const { method, params, id } = parsed;
        log(`RPC: method=${method}, id=${id}, params=${JSON.stringify(params)}`);
        
        let result;
        
        if (method === 'initialize') {
          result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'UniFi Protect MCP', version: VERSION } };
        } else if (method === 'notifications/initialized' || method === 'initialized') {
          result = {};
        } else if (method === 'ping') {
          result = {};
        } else if (method === 'tools/list') {
          result = { tools: TOOLS };
        } else if (method === 'tools/call') {
          const toolResult = await executeTool(params.name, params.arguments || {});
          result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        } else {
          log(`WARN: Unknown method ${method}`);
          result = {};
        }
        
        const response = { jsonrpc: '2.0', id, result };
        log(`RESPONSE: ${JSON.stringify(response).slice(0, 200)}`);
        
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (e) {
        log(`ERROR: ${e.message}`);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: e.message } }));
      }
    });
    return;
  }
  
  res.writeHead(404, cors);
  res.end('Not found');
});

server.listen(PORT, () => log(`UniFi Protect MCP v${VERSION} listening on port ${PORT}`));
