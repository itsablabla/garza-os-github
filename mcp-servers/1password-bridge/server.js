'use strict';
/* 1password stdio -> StreamableHTTP bridge
   Spawns `npx -y @takescake/1password-mcp` (env OP_SERVICE_ACCOUNT_TOKEN),
   exposes POST /mcp (JSON-RPC over streamable HTTP), GET /sse + /status.
   Optional Bearer gate: if GATE_TOKEN is set, require Authorization: Bearer <GATE_TOKEN>.
   One persistent child; requests serialized on stdio. */
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const GATE = process.env.GATE_TOKEN || '';
const CHILD_CMD = process.env.CHILD_CMD || 'npx';
const CHILD_ARGS = JSON.parse(process.env.CHILD_ARGS || '["-y","@takescake/1password-mcp"]');

let child = null;
let booting = false;
const pending = [];           // [{resolve,reject}] waiting for child boot
const sessions = new Map();   // clientSessionId -> {childReqId: childResponse}

function log(...a) { console.log(new Date().toISOString(), ...a); }

function ensureChild() {
  if (child && child.exitCode === null) return Promise.resolve(child);
  if (booting) return new Promise((res, rej) => pending.push({ res, rej }));
  booting = true;
  log('spawning child:', CHILD_CMD, CHILD_ARGS.join(' '));
  child = spawn(CHILD_CMD, CHILD_ARGS, {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout.on('data', d => {
    buf += d.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { log('bad child line', line.slice(0,200)); continue; }
      handleChildMessage(msg);
    }
  });
  child.stderr.on('data', d => log('child stderr:', String(d).trim().slice(0, 300)));
  child.on('exit', (c, s) => {
    log('child exited', c, s);
    child = null; booting = false;
    // fail any client requests still awaiting child responses
    for (const { respond, reqId } of [...pendingClient]) {
      try { respond(JSON.stringify({ jsonrpc: '2.0', id: reqId, error: { code: -32000, message: 'child exited' } })); } catch {}
    }
    pendingClient.length = 0;
  });
  // drain booting waiters after child spawn (initialize handshake happens on first request)
  child.on('spawn', () => { booting = false; while (pending.length) pending.shift().res(child); });
  return Promise.resolve(child);
}

// client requests awaiting child response (keyed by our seq)
const pendingClient = new Map(); // ourSeq -> {respond, reqId}

let seq = 1;
function sendChild(msg, clientSessionId) {
  return new Promise((resolve, reject) => {
    ensureChild().then(ch => {
      const myId = seq++;
      pendingClient.set(myId, { respond: resolve, reqId: msg.id, session: clientSessionId });
      ch.stdin.write(JSON.stringify({ ...msg, id: myId }) + '\n');
      // safety timeout
      setTimeout(() => { if (pendingClient.has(myId)) { pendingClient.delete(myId); resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: 'child timeout' } })); } }, 60000);
    }).catch(e => resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(e) } })));
  });
}

function handleChildMessage(msg) {
  // child responses are plain JSON-RPC (possibly with id from our seq)
  const waiter = pendingClient.get(msg.id);
  if (waiter) {
    pendingClient.delete(msg.id);
    const out = { ...msg, id: waiter.reqId };
    waiter.respond(JSON.stringify(out));
  } else {
    log('unexpected child msg', JSON.stringify(msg).slice(0, 200));
  }
}

function authOk(req) {
  if (!GATE) return true;
  const h = req.headers.authorization || '';
  return h === 'Bearer ' + GATE;
}

function jsonBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { res(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { rej(e); }
    });
    req.on('error', rej);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/status' || req.url === '/health' || req.url === '/healthz')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', child: !!(child && child.exitCode === null) }));
  }
  if (req.method === 'GET' && req.url.startsWith('/sse')) {
    if (!authOk(req)) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('unauthorized'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const iv = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => clearInterval(iv));
    return;
  }
  if (req.method === 'GET' && (req.url === '/mcp' || req.url === '/mcp/')) {
    // streamable HTTP GET: open SSE stream (used by some clients for server->client messages)
    if (!authOk(req)) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('unauthorized'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const iv = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => clearInterval(iv));
    return;
  }
  if (req.method !== 'POST' || !(req.url === '/mcp' || req.url === '/mcp/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found');
  }
  if (!authOk(req)) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('unauthorized'); }
  let msg;
  try { msg = await jsonBody(req); } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
  }
  if (msg.method === 'initialize') {
    const sid = crypto.randomUUID();
    sessions.set(sid, {});
    const resp = await sendChild(msg, sid);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': sid, 'mcp-session-id': sid });
    return res.end(resp);
  }
  // all other methods: pass through with optional session header
  const sid = req.headers['mcp-session-id'];
  const resp = await sendChild(msg, sid || '');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(resp);
});

server.listen(PORT, '0.0.0.0', () => log('1password bridge listening on :' + PORT));
