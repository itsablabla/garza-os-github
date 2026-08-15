'use strict';
/* Consolidated Lark gateway — ONE container, 2 instances (intl-all + cn-all).
   Per-category overrides: domain/appId/appSecret may use ${ENV_NAME} references. */
const { spawn } = require('child_process');
const http = require('http');
const { categories } = require('./categories-merged.json');

function resolveEnv(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\$\{([A-Z0-9_]+)\}/g, (m, name) => process.env[name] || '');
}

const LISTEN_PORT = Number(process.env.PORT || 3000);
const RESTART_DELAY_MS = 3000;
const children = new Map();

function startCategory(cat) {
  const env = { ...process.env,
    APP_ID: resolveEnv(cat.appId) || process.env.APP_ID,
    APP_SECRET: resolveEnv(cat.appSecret) || process.env.APP_SECRET,
    LARK_DOMAIN: cat.domain || process.env.LARK_DOMAIN,
    LARK_TOOLS: cat.tools.join(','),
  };
  const child = spawn('npx', ['--no-install', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
    '-m', 'streamable', '--host', '127.0.0.1', '-p', String(cat.port)], { env, stdio: ['ignore','pipe','pipe'] });
  children.set(cat.name, child);
  const tag = `[${cat.name}]`;
  child.stdout.on('data', d => process.stdout.write(tag + ' ' + d));
  child.stderr.on('data', d => process.stderr.write(tag + ' ' + d));
  child.on('exit', (code, sig) => {
    console.error(`${tag} exited (${code}/${sig}); restarting in ${RESTART_DELAY_MS}ms`);
    children.delete(cat.name);
    setTimeout(() => { try { startCategory(cat); } catch (e) { console.error(tag, 'restart failed', e); } }, RESTART_DELAY_MS);
  });
  console.log(`${tag} spawning on 127.0.0.1:${cat.port} (${cat.tools.length} tools, ${cat.domain || 'default domain'})`);
}

const byName = new Map(categories.map(c => [c.name, c]));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/([a-z0-9]+)\/mcp$/);
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/health')) {
    res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('ok');
  }
  if (!m || !byName.has(m[1])) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('not found'); }
  const cat = byName.get(m[1]);
  const upstream = http.request({ host:'127.0.0.1', port: cat.port, path:'/mcp' + url.search,
    method: req.method, headers: { ...req.headers, host: `127.0.0.1:${cat.port}` } }, up => {
    res.writeHead(up.statusCode || 502, up.headers); up.pipe(res);
  });
  upstream.on('error', e => { if (!res.headersSent) res.writeHead(502, {'Content-Type':'text/plain'}); res.end('upstream unavailable'); });
  req.pipe(upstream);
});
server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`consolidated lark gateway on :${LISTEN_PORT}`);
  for (const cat of categories) startCategory(cat);
});
for (const sig of ['SIGTERM','SIGINT']) process.on(sig, () => {
  for (const c of children.values()) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
});
