'use strict';
/* Lark MCP category gateway — spawns one streamable lark-mcp instance per category
   and proxies /<category>/mcp -> 127.0.0.1:<port>/mcp */
const { spawn } = require('child_process');
const http = require('http');
const CATEGORIES_FILE = process.env.CATEGORIES_FILE || './categories.json';
const CATEGORIES_FILTER = (process.env.LARK_CATEGORIES || '').split(',').map(s => s.trim()).filter(Boolean);
const { categories: ALL_CATEGORIES } = require(CATEGORIES_FILE);
const categories = CATEGORIES_FILTER.length
  ? ALL_CATEGORIES.filter(c => CATEGORIES_FILTER.includes(c.name))
  : ALL_CATEGORIES;

const APP_ID = process.env.APP_ID;
const APP_SECRET = process.env.APP_SECRET;
const LARK_DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const LISTEN_PORT = Number(process.env.PORT || 3000);
const LARK_TOOLS_ARG = process.env.LARK_TOOLS_ARG; // optional extra tool ids appended to every category
const RESTART_DELAY_MS = 3000;

const children = new Map();

function startCategory(cat) {
  const tools = LARK_TOOLS_ARG ? cat.tools.concat(LARK_TOOLS_ARG.split(',')) : cat.tools;
  const args = ['--no-install', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
    '-m', 'streamable', '--host', '127.0.0.1', '-p', String(cat.port)];
  const child = spawn('npx', args, {
    env: { ...process.env, APP_ID, APP_SECRET, LARK_DOMAIN, LARK_TOOLS: tools.join(',') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(cat.name, child);
  const tag = `[${cat.name}]`;
  child.stdout.on('data', (d) => process.stdout.write(tag + ' ' + d));
  child.stderr.on('data', (d) => process.stderr.write(tag + ' ' + d));
  child.on('exit', (code, sig) => {
    console.error(`${tag} exited (code=${code} sig=${sig}); restarting in ${RESTART_DELAY_MS}ms`);
    children.delete(cat.name);
    setTimeout(() => { try { startCategory(cat); } catch (e) { console.error(tag, 'restart failed', e); } }, RESTART_DELAY_MS);
  });
  console.log(`${tag} spawning on 127.0.0.1:${cat.port} (${tools.length} tools)`);
}

const byName = new Map(categories.map((c) => [c.name, c]));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/([a-z]+)\/mcp$/);
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (!m || !byName.has(m[1])) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  const cat = byName.get(m[1]);
  const upstream = http.request({
    host: '127.0.0.1', port: cat.port, path: '/mcp' + url.search,
    method: req.method, headers: { ...req.headers, host: `127.0.0.1:${cat.port}` },
  }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => {
    console.error(`[${cat.name}] upstream error:`, e.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('upstream unavailable');
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`lark-mcp category gateway listening on :${LISTEN_PORT} (file=${CATEGORIES_FILE}, ${categories.length}/${ALL_CATEGORIES.length} categories)`);
  for (const cat of categories) startCategory(cat);
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  for (const c of children.values()) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
});
