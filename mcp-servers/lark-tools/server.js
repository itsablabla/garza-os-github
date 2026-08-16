'use strict';
/* lark-tools MCP — dedicated Lark drive/doc/mail tools for agents.
   Streamable HTTP (SSE-framed so Bifrost can parse it). Self-refreshes the
   user access token via OIDC refresh (env: LARK_USER_TOKEN, LARK_REFRESH_TOKEN,
   APP_ID, APP_SECRET, LARK_DOMAIN). */
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PORT || 8080);
const DOMAIN = (process.env.LARK_DOMAIN || 'https://open.larksuite.com').replace(/\/+$/, '');
const MAILBOX = process.env.LARK_MAILBOX || 'jaden@garza.online';

let UAT = process.env.LARK_USER_TOKEN || '';
let REFRESH = process.env.LARK_REFRESH_TOKEN || '';
const APP_ID = process.env.APP_ID || '';
const APP_SECRET = process.env.APP_SECRET || '';

const req = (method, path, body, token) => new Promise((resolve, reject) => {
  const transport = DOMAIN.startsWith('https') ? https : http;
  const data = body ? JSON.stringify(body) : null;
  const r = transport.request(DOMAIN + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
    },
  }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      try { resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
      catch (e) { resolve({ status: res.statusCode, json: {} }); }
    });
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

async function refreshUAT() {
  if (!REFRESH || !APP_ID || !APP_SECRET) return null;
  const ar = await req('POST', '/open-apis/auth/v3/app_access_token/internal', { app_id: APP_ID, app_secret: APP_SECRET });
  if (!ar.json || ar.json.code !== 0 || !ar.json.app_access_token) return null;
  const r = await req('POST', '/open-apis/authen/v1/oidc/refresh_access_token', {
    grant_type: 'refresh_token', refresh_token: REFRESH,
  }, ar.json.app_access_token);
  if (!r.json || r.json.code !== 0 || !r.json.data || !r.json.data.access_token) return null;
  UAT = r.json.data.access_token;
  if (r.json.data.refresh_token) REFRESH = r.json.data.refresh_token;
  return UAT;
}

async function withToken() {
  if (!UAT) await refreshUAT();
  return UAT;
}
async function api(method, path, body, retried) {
  let token = await withToken();
  let r = await req(method, path, body, token);
  if ((r.json.code === 99991668 || r.json.code === 99991663 || r.status === 401) && !retried) {
    await refreshUAT();
    r = await req(method, path, body, UAT);
  }
  return r.json;
}

async function handleTool(name, args) {
  const p = args || {};
  switch (name) {
    case 'list_folder': {
      const j = await api('GET', '/open-apis/drive/v1/files?folder_token=' + encodeURIComponent(p.folder_token || '') + '&page_size=50');
      return { ok: j.code === 0, code: j.code, files: (j.data && j.data.files || []).map(f => ({ name: f.name, token: f.token, type: f.type })) };
    }
    case 'get_doc': {
      const j = await api('GET', '/open-apis/docx/v1/documents/' + encodeURIComponent(p.document_id || '') + '/raw_content');
      return { ok: j.code === 0, code: j.code, content: j.data ? j.data.content : null };
    }
    case 'create_doc': {
      const j = await api('POST', '/open-apis/docx/v1/documents', { folder_token: p.folder_token || '', title: String(p.title || 'Untitled') });
      return { ok: j.code === 0, code: j.code, document_id: j.data && j.data.document && j.data.document.document_id };
    }
    case 'upload_file': {
      const b64 = String(p.content_base64 || '');
      if (!p.filename || !b64) return { ok: false, error: 'filename + content_base64 required' };
      const buf = Buffer.from(b64, 'base64');
      const boundary = '----garza' + Date.now();
      let parts = '--' + boundary + '\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n' + p.filename + '\r\n';
      parts += '--' + boundary + '\r\nContent-Disposition: form-data; name="parent_type"\r\n\r\nexplorer\r\n';
      parts += '--' + boundary + '\r\nContent-Disposition: form-data; name="parent_node"\r\n\r\n' + (p.folder_token || '') + '\r\n';
      parts += '--' + boundary + '\r\nContent-Disposition: form-data; name="size"\r\n\r\n' + buf.length + '\r\n';
      const head = '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + p.filename + '"\r\nContent-Type: application/octet-stream\r\n\r\n';
      const full = Buffer.concat([Buffer.from(parts + head, 'utf8'), buf, Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8')]);
      const token = await withToken();
      const j = await new Promise((resolve, reject) => {
        const transport = DOMAIN.startsWith('https') ? https : http;
        const r = transport.request(DOMAIN + '/open-apis/drive/v1/files/upload_all', { method: 'POST', headers: {
          'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': full.length }, }, res => {
          const c = []; res.on('data', d => c.push(d)); res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(c).toString('utf8'))); } catch (e) { resolve({}); }
          });
        });
        r.on('error', reject); r.write(full); r.end();
      });
      if (j.code === 99991668 && (await refreshUAT())) {
        return handleTool('upload_file', p);
      }
      return { ok: j.code === 0, code: j.code, file_token: j.data && j.data.file_token };
    }
    case 'list_mail': {
      const j = await api('GET', '/open-apis/mail/v1/user_mailboxes/' + encodeURIComponent(MAILBOX) + '/messages?folder_id=' + encodeURIComponent(p.folder || 'INBOX') + '&page_size=' + (p.limit || 10));
      return { ok: j.code === 0, code: j.code, ids: j.data && j.data.items || [] };
    }
    case 'read_mail': {
      const j = await api('GET', '/open-apis/mail/v1/user_mailboxes/' + encodeURIComponent(MAILBOX) + '/messages/' + encodeURIComponent(p.message_id || ''));
      const m = j.data && j.data.message || {};
      return { ok: j.code === 0, code: j.code, subject: m.subject, from: m.head_from, date: m.internal_date, body: (m.body_plain_text || '').slice(0, 2000) };
    }
    default:
      return { ok: false, error: 'unknown tool ' + name };
  }
}

const TOOLS = [
  { name: 'list_folder', description: 'List a Lark Drive folder: files, subfolders, tokens, types. Params: folder_token.' },
  { name: 'get_doc', description: 'Get the full text of a native Lark document. Params: document_id.' },
  { name: 'create_doc', description: 'Create a native Lark document in a folder. Params: title, folder_token.' },
  { name: 'upload_file', description: 'Upload a file to a Lark Drive folder. Params: filename, content_base64, folder_token.' },
  { name: 'list_mail', description: 'List message ids in the Garza mailbox (jaden@garza.online). Params: folder (INBOX), limit.' },
  { name: 'read_mail', description: 'Read a mailbox message (subject, from, body). Params: message_id.' },
];

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok');
  }
  if (req.method !== 'POST' || !(req.url === '/mcp' || req.url === '/mcp/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found');
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { msg = {}; }
    let result;
    if (msg.method === 'initialize') {
      result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'lark-tools', version: '1.0.0' } };
    } else if (msg.method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (msg.method === 'tools/call') {
      const t = msg.params && msg.params.name;
      const out = await handleTool(t, msg.params && msg.params.arguments);
      result = { content: [{ type: 'text', text: JSON.stringify(out) }] };
    } else {
      result = {};
    }
    const out = 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n\n';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(out) });
    res.end(out);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('lark-tools MCP listening on :' + PORT));
