'use strict';
/* Consolidated Lark gateway — ONE VM, 2 processes (intl + cn).
   17 category paths route to one of the two instances; the router filters
   tools/list per category so each path exposes only its category's tools.
   Bifrost keeps 17 separate lark clients, all hitting this one container. */
const { spawn } = require('child_process');
const http = require('http');
const { categories, categoryTools, intlCats, cnCats } = require('./categories-merged.json');

function resolveEnv(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\$\{([A-Z0-9_]+)\}/g, (m, name) => process.env[name] || '');
}

const LISTEN_PORT = Number(process.env.PORT || 3000);
const RESTART_DELAY_MS = 3000;
const children = new Map();

function startInstance(inst) {
  const env = { ...process.env,
    APP_ID: resolveEnv(inst.appId) || process.env.APP_ID,
    APP_SECRET: resolveEnv(inst.appSecret) || process.env.APP_SECRET,
    LARK_DOMAIN: inst.domain || process.env.LARK_DOMAIN,
    LARK_TOOLS: inst.tools.join(','),
  };
  const args = ['--no-install', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
    '-m', 'streamable', '--host', '127.0.0.1', '-p', String(inst.port)];
  // -u at spawn keeps the auth handler unset; the per-request Authorization header
  // (added below) carries the token past lark-mcp v0.5.1's streamable bug.
  if (process.env.LARK_USER_ACCESS_TOKEN && !inst.domain) args.push('-u', process.env.LARK_USER_ACCESS_TOKEN);
  const child = spawn('npx', args, { env, stdio: ['ignore','pipe','pipe'] });
  children.set(inst.name, child);
  const tag = `[${inst.name}]`;
  child.stdout.on('data', d => process.stdout.write(tag + ' ' + d));
  child.stderr.on('data', d => process.stderr.write(tag + ' ' + d));
  child.on('exit', (code, sig) => {
    console.error(`${tag} exited (${code}/${sig}); restarting in ${RESTART_DELAY_MS}ms`);
    children.delete(inst.name);
    setTimeout(() => { try { startInstance(inst); } catch (e) { console.error(tag, 'restart failed', e); } }, RESTART_DELAY_MS);
  });
  console.log(`${tag} spawning on 127.0.0.1:${inst.port} (${inst.tools.length} tools, ${inst.domain || 'intl'})`);
}

const byName = new Map(categories.map(c => [c.name, c]));
const catInstance = name => intlCats.includes(name) ? 'intl' : (cnCats.includes(name) ? 'cn' : null);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/([a-z0-9]+)\/mcp$/);
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/health')) {
    res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('ok');
  }
  if (!m) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('not found'); }
  const pathName = m[1];
  // merged surfaces
  const instName = (pathName === 'intl' || pathName === 'cn') ? pathName : catInstance(pathName);
  const inst = instName ? byName.get(instName) : null;
  if (!inst) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('not found'); }
  // per-category tool filtering (normalize dot names -> snake as returned by the server)
  const filterTools = (categoryTools[pathName] && pathName !== 'intl' && pathName !== 'cn')
    ? categoryTools[pathName].map(n => n.replace(/\./g, '_'))
    : null;
  const proxyHeaders = { ...req.headers, host: `127.0.0.1:${inst.port}` };
  if (process.env.LARK_USER_ACCESS_TOKEN && !inst.domain) {
    proxyHeaders['authorization'] = 'Bearer ' + process.env.LARK_USER_ACCESS_TOKEN;
  }
  const upstream = http.request({ host:'127.0.0.1', port: inst.port, path:'/mcp' + url.search,
    method: req.method, headers: proxyHeaders }, up => {
    if (!filterTools || req.method !== 'POST') {
      res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); return;
    }
    const chunks = [];
    up.on('data', c => chunks.push(c));
    up.on('end', () => {
      let raw = Buffer.concat(chunks).toString('utf8');
      try {
        const m2 = raw.match(/data: (\{.*\})/);
        if (m2) {
          const msg = JSON.parse(m2[1]);
          if (msg.result && Array.isArray(msg.result.tools)) {
            msg.result.tools = msg.result.tools.filter(t => filterTools.includes(t.name));
            raw = raw.replace(m2[1], JSON.stringify(msg));
            console.log(`${pathName}: tools/list filtered to ${msg.result.tools.length}`);
          }
        }
      } catch (e) { console.error(`${pathName}: filter error`, e.message); }
      res.writeHead(up.statusCode || 502, { ...up.headers, 'content-length': Buffer.byteLength(raw) });
      res.end(raw);
    });
  });
  upstream.on('error', e => { if (!res.headersSent) res.writeHead(502, {'Content-Type':'text/plain'}); res.end('upstream unavailable'); });
  req.pipe(upstream);
});
server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`consolidated lark gateway on :${LISTEN_PORT} — ${categories.length} instances, ${Object.keys(categoryTools).length} category paths`);
  for (const inst of categories) startInstance(inst);
});
for (const sig of ['SIGTERM','SIGINT']) process.on(sig, () => {
  for (const c of children.values()) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
});
