'use strict';
/* Beeperbox SSE-framing bridge: forwards MCP streamable POSTs to the upstream
   beeperbox server (plain JSON) and re-frames responses as SSE so Bifrost can parse them. */
const http = require('http');
const https = require('https');
const UPSTREAM = new URL(process.env.BEEPERBOX_URL || 'https://tools.garza.online/beeperbox/');
const AUTH = process.env.BEEPERBOX_TOKEN || '';
const PORT = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok');
  }
  if (req.method !== 'POST' || !(req.url === '/mcp' || req.url === '/mcp/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found');
  }
  console.log('REQ', req.method, req.url, JSON.stringify(req.headers));
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    console.log('BODY', Buffer.concat(chunks).toString('utf8').slice(0,200));
    const payload = Buffer.concat(chunks);
    const transport = UPSTREAM.protocol === 'https:' ? https : http;
    const upReq = transport.request({
      hostname: UPSTREAM.hostname, port: UPSTREAM.port || undefined,
      path: UPSTREAM.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': payload.length,
        ...(AUTH ? { 'Authorization': 'Bearer ' + AUTH } : {}),
      },
    }, upRes => {
      const body = [];
      upRes.on('data', c => body.push(c));
      upRes.on('end', () => {
        const raw = Buffer.concat(body).toString('utf8');
        const framed = /event: message|^data: /.test(raw)
          ? raw
          : 'event: message\ndata: ' + raw.trim() + '\n\n';
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(framed) });
        res.end(framed);
      });
    });
    upReq.on('error', e => { console.log('UPERR', String(e)); if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('upstream unavailable'); });
    upReq.write(payload);
    upReq.end();
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('beeperbox bridge listening on :' + PORT));
