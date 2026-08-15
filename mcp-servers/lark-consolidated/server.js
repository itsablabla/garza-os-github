'use strict';
/* Consolidated Lark gateway — ONE container, 2 instances, ALL category paths.
   intl categories -> intl instance (8081); cn categories -> cn instance (8082).
   Also serves /intl/mcp and /cn/mcp. */
const { spawn } = require('child_process');
const http = require('http');
const { categories } = require('./categories-merged.json');

const INTL_CATS = ['admin','approval','docs','bitable','calendar','contact','drive','im','mail','task','vc','misc'];
const CN_CATS = ['acs','apaas','attendance','hr','hire'];

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
  const args = ['--no-install', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
    '-m', 'streamable', '--host', '127.0.0.1', '-p', String(cat.port)];
  // -u at startup keeps this.auth unset (token used as-is); the per-request
  // Authorization header (added below) carries the token past v0.5.1's streamable bug.
  if (process.env.LARK_USER_ACCESS_TOKEN) args.push('-u', process.env.LARK_USER_ACCESS_TOKEN);
  const child = spawn('npx', args, { env, stdio: ['ignore','pipe','pipe'] });
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
function resolveInstance(pathName) {
  if (byName.has(pathName)) return byName.get(pathName);
  if (INTL_CATS.includes(pathName)) return byName.get('intl');
  if (CN_CATS.includes(pathName)) return byName.get('cn');
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/([a-z0-9]+)\/mcp$/);
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/health')) {
    res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('ok');
  }
  const cat = m ? resolveInstance(m[1]) : null;
  if (!cat) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('not found'); }
  const proxyHeaders = { ...req.headers, host: `127.0.0.1:${cat.port}` };
  // lark-mcp v0.5.1 drops the CLI -u flag in streamable mode; it DOES honor the
  // Authorization header. Inject the user access token for the intl instance.
  const isIntl = cat.name === 'intl' || INTL_CATS.includes(cat.name);
  if (process.env.LARK_USER_ACCESS_TOKEN && isIntl) {
    proxyHeaders['authorization'] = 'Bearer ' + process.env.LARK_USER_ACCESS_TOKEN;
    console.log(`${cat.name}: Authorization header (UAT) injected`);
  }
  const upstream = http.request({ host:'127.0.0.1', port: cat.port, path:'/mcp' + url.search,
    method: req.method, headers: proxyHeaders }, up => {
    res.writeHead(up.statusCode || 502, up.headers); up.pipe(res);
  });
  upstream.on('error', e => { if (!res.headersSent) res.writeHead(502, {'Content-Type':'text/plain'}); res.end('upstream unavailable'); });
  req.pipe(upstream);
});
server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`consolidated lark gateway on :${LISTEN_PORT} — intl cats: ${INTL_CATS.join(',')}; cn cats: ${CN_CATS.join(',')}`);
  for (const cat of categories) startCategory(cat);
});
for (const sig of ['SIGTERM','SIGINT']) process.on(sig, () => {
  for (const c of children.values()) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
});
