import express from 'express';
import { randomUUID } from 'crypto';
import { Client } from 'ssh2';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MCP_KEY = process.env.MCP_KEY || 'lrlab-dev-v2-a7c9e3f18b2d4e6f';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SCOUT_API_KEY = process.env.SCOUT_API_KEY;
const SSH_PRIVATE_KEY = process.env.SSH_PRIVATE_KEY;
const FLY_API_TOKEN = process.env.FLY_API_TOKEN;
const CF_API_KEY = process.env.CF_API_KEY;
const CF_EMAIL = process.env.CF_EMAIL || 'jadengarza@pm.me';
const CF_ZONE_ID = process.env.CF_ZONE_ID || '9c70206ce57d506d1d4e9397f6bb8ebc'; // garzahive.com
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://garzasync.app.n8n.cloud/api/v1';

const clients = new Map();

const SSH_HOSTS = {
  garzahive: { host: '143.198.190.20', username: 'root' },
  mac: { host: 'ssh.garzahive.com', username: 'customer' },
  n8n: { host: '167.172.147.240', username: 'root' }
};

// MCP endpoints to health check
const MCP_ENDPOINTS = {
  'garza-home-mcp': 'https://garza-home-mcp.fly.dev/health',
  'beeper-matrix-mcp': 'https://beeper-mcp.garzahive.com/health',
  'lrlab-mcp': 'https://lastrock-mcp.garzahive.com/health',
  'cf-mcp': 'https://mcp-cf.garzahive.com/health',
  'n8n-mcp': 'https://n8n-mcp.garzahive.com/health'
};

const TOOLS = [
  // === CORE ===
  { name: 'ping', description: 'Health check', inputSchema: { type: 'object', properties: {}, required: [] } },
  
  // === SSH ===
  { name: 'ssh_exec', description: 'Execute command via SSH. Hosts: garzahive, mac, n8n', inputSchema: { type: 'object', properties: { host: { type: 'string' }, command: { type: 'string' }, timeout: { type: 'number' } }, required: ['host', 'command'] } },
  { name: 'ssh_hosts', description: 'List SSH hosts', inputSchema: { type: 'object', properties: {}, required: [] } },
  
  // === GITHUB ===
  { name: 'github_list_repos', description: 'List repos', inputSchema: { type: 'object', properties: { owner: { type: 'string', default: 'itsablabla' }, per_page: { type: 'number' } }, required: [] } },
  { name: 'github_get_repo', description: 'Get repo details', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] } },
  { name: 'github_list_issues', description: 'List issues', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } }, required: ['owner', 'repo'] } },
  { name: 'github_create_issue', description: 'Create issue', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['owner', 'repo', 'title'] } },
  { name: 'github_create_repo', description: 'Create repo', inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean' }, org: { type: 'string' } }, required: ['name'] } },
  { name: 'github_list_prs', description: 'List pull requests', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } }, required: ['owner', 'repo'] } },
  { name: 'github_create_pr', description: 'Create pull request', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, head: { type: 'string' }, base: { type: 'string', default: 'main' } }, required: ['owner', 'repo', 'title', 'head'] } },
  { name: 'github_get_workflow_runs', description: 'Get workflow runs', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, workflow_id: { type: 'string' }, per_page: { type: 'number' } }, required: ['owner', 'repo'] } },
  { name: 'github_trigger_workflow', description: 'Trigger workflow dispatch', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, workflow_id: { type: 'string' }, ref: { type: 'string', default: 'main' }, inputs: { type: 'object' } }, required: ['owner', 'repo', 'workflow_id'] } },
  { name: 'github_get_file', description: 'Get file contents', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string' } }, required: ['owner', 'repo', 'path'] } },
  { name: 'github_update_file', description: 'Create or update file', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' }, sha: { type: 'string' }, branch: { type: 'string' } }, required: ['owner', 'repo', 'path', 'content', 'message'] } },

  // === FLY.IO ===
  { name: 'fly_list_apps', description: 'List all Fly apps', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'fly_get_app', description: 'Get app details', inputSchema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] } },
  { name: 'fly_logs', description: 'Get recent logs', inputSchema: { type: 'object', properties: { app: { type: 'string' }, lines: { type: 'number', default: 50 } }, required: ['app'] } },
  { name: 'fly_restart', description: 'Restart app machines', inputSchema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] } },
  { name: 'fly_set_secret', description: 'Set app secret', inputSchema: { type: 'object', properties: { app: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' } }, required: ['app', 'key', 'value'] } },

  // === CLOUDFLARE DNS ===
  { name: 'cf_list_dns', description: 'List DNS records for garzahive.com', inputSchema: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' } }, required: [] } },
  { name: 'cf_create_dns', description: 'Create DNS record', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'TXT', 'MX'] }, name: { type: 'string' }, content: { type: 'string' }, proxied: { type: 'boolean', default: false }, ttl: { type: 'number', default: 1 } }, required: ['type', 'name', 'content'] } },
  { name: 'cf_delete_dns', description: 'Delete DNS record by ID', inputSchema: { type: 'object', properties: { record_id: { type: 'string' } }, required: ['record_id'] } },

  // === N8N CLOUD (garzasync) ===
  { name: 'n8n_list_workflows', description: 'List n8n workflows', inputSchema: { type: 'object', properties: { active: { type: 'boolean' }, limit: { type: 'number' } }, required: [] } },
  { name: 'n8n_get_workflow', description: 'Get workflow by ID', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'n8n_execute_workflow', description: 'Execute workflow', inputSchema: { type: 'object', properties: { id: { type: 'string' }, data: { type: 'object' } }, required: ['id'] } },
  { name: 'n8n_activate_workflow', description: 'Activate/deactivate workflow', inputSchema: { type: 'object', properties: { id: { type: 'string' }, active: { type: 'boolean' } }, required: ['id', 'active'] } },
  { name: 'n8n_list_executions', description: 'List workflow executions', inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, status: { type: 'string', enum: ['success', 'error', 'waiting'] }, limit: { type: 'number' } }, required: [] } },

  // === HEALTH/MONITORING ===
  { name: 'health_check_all', description: 'Check all MCP endpoints', inputSchema: { type: 'object', properties: {}, required: [] } },

  // === SCOUT APM ===
  { name: 'scout_list_apps', description: 'List Scout APM apps', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'scout_get_app_endpoints', description: 'Get endpoints metrics', inputSchema: { type: 'object', properties: { app_id: { type: 'integer' }, from_: { type: 'string' }, to: { type: 'string' } }, required: ['app_id', 'from_', 'to'] } },
  { name: 'scout_get_insights', description: 'N+1, memory bloat, slow queries', inputSchema: { type: 'object', properties: { app_id: { type: 'integer' }, insight_type: { type: 'string' }, limit: { type: 'integer' } }, required: ['app_id'] } },
  { name: 'scout_get_error_groups', description: 'Error groups', inputSchema: { type: 'object', properties: { app_id: { type: 'integer' }, from_: { type: 'string' }, to: { type: 'string' } }, required: ['app_id', 'from_', 'to'] } }
];

// ========== HANDLERS ==========

async function handleTool(name, args) {
  switch (name) {
    // CORE
    case 'ping': return { status: 'pong', timestamp: new Date().toISOString(), server: 'lrlab-mcp-v3' };
    case 'ssh_hosts': return { hosts: Object.keys(SSH_HOSTS), config: SSH_HOSTS };
    case 'ssh_exec': return execSSH(args.host, args.command, args.timeout || 30000);

    // GITHUB
    case 'github_list_repos': return githubAPI(`/users/${args.owner || 'itsablabla'}/repos?per_page=${args.per_page || 30}`);
    case 'github_get_repo': return githubAPI(`/repos/${args.owner}/${args.repo}`);
    case 'github_list_issues': return githubAPI(`/repos/${args.owner}/${args.repo}/issues?state=${args.state || 'open'}`);
    case 'github_create_issue': return githubAPI(`/repos/${args.owner}/${args.repo}/issues`, 'POST', { title: args.title, body: args.body, labels: args.labels });
    case 'github_create_repo': return githubAPI(args.org ? `/orgs/${args.org}/repos` : '/user/repos', 'POST', { name: args.name, description: args.description, private: args.private !== false });
    case 'github_list_prs': return githubAPI(`/repos/${args.owner}/${args.repo}/pulls?state=${args.state || 'open'}`);
    case 'github_create_pr': return githubAPI(`/repos/${args.owner}/${args.repo}/pulls`, 'POST', { title: args.title, body: args.body, head: args.head, base: args.base || 'main' });
    case 'github_get_workflow_runs': {
      let url = `/repos/${args.owner}/${args.repo}/actions/runs?per_page=${args.per_page || 10}`;
      if (args.workflow_id) url = `/repos/${args.owner}/${args.repo}/actions/workflows/${args.workflow_id}/runs?per_page=${args.per_page || 10}`;
      return githubAPI(url);
    }
    case 'github_trigger_workflow': return githubAPI(`/repos/${args.owner}/${args.repo}/actions/workflows/${args.workflow_id}/dispatches`, 'POST', { ref: args.ref || 'main', inputs: args.inputs || {} });
    case 'github_get_file': {
      const url = `/repos/${args.owner}/${args.repo}/contents/${args.path}${args.ref ? `?ref=${args.ref}` : ''}`;
      const res = await githubAPI(url);
      if (res.content) res.decoded = Buffer.from(res.content, 'base64').toString('utf8');
      return res;
    }
    case 'github_update_file': {
      const payload = { message: args.message, content: Buffer.from(args.content).toString('base64') };
      if (args.sha) payload.sha = args.sha;
      if (args.branch) payload.branch = args.branch;
      return githubAPI(`/repos/${args.owner}/${args.repo}/contents/${args.path}`, 'PUT', payload);
    }

    // FLY.IO
    case 'fly_list_apps': return flyGraphQL(`query { apps { nodes { id name status hostname currentRelease { version createdAt } } } }`);
    case 'fly_get_app': return flyGraphQL(`query { app(name: "${args.app}") { id name status hostname organization { slug } machines { nodes { id name state region } } currentRelease { version createdAt } } }`);
    case 'fly_logs': return flyLogsAPI(args.app, args.lines || 50);
    case 'fly_restart': return flyRestartApp(args.app);
    case 'fly_set_secret': return flyGraphQL(`mutation { setSecrets(input: { appId: "${args.app}", secrets: [{ key: "${args.key}", value: "${args.value}" }] }) { app { name } } }`);

    // CLOUDFLARE DNS
    case 'cf_list_dns': return cfAPI(`/zones/${CF_ZONE_ID}/dns_records${args.type || args.name ? '?' : ''}${args.type ? `type=${args.type}` : ''}${args.type && args.name ? '&' : ''}${args.name ? `name=${args.name}` : ''}`);
    case 'cf_create_dns': return cfAPI(`/zones/${CF_ZONE_ID}/dns_records`, 'POST', { type: args.type, name: args.name, content: args.content, proxied: args.proxied || false, ttl: args.ttl || 1 });
    case 'cf_delete_dns': return cfAPI(`/zones/${CF_ZONE_ID}/dns_records/${args.record_id}`, 'DELETE');

    // N8N CLOUD
    case 'n8n_list_workflows': return n8nAPI(`/workflows${args.active !== undefined ? `?active=${args.active}` : ''}${args.limit ? `${args.active !== undefined ? '&' : '?'}limit=${args.limit}` : ''}`);
    case 'n8n_get_workflow': return n8nAPI(`/workflows/${args.id}`);
    case 'n8n_execute_workflow': return n8nAPI(`/workflows/${args.id}/execute`, 'POST', args.data || {});
    case 'n8n_activate_workflow': return n8nAPI(`/workflows/${args.id}`, 'PATCH', { active: args.active });
    case 'n8n_list_executions': {
      let url = '/executions?';
      if (args.workflowId) url += `workflowId=${args.workflowId}&`;
      if (args.status) url += `status=${args.status}&`;
      url += `limit=${args.limit || 20}`;
      return n8nAPI(url);
    }

    // HEALTH
    case 'health_check_all': return healthCheckAll();

    // SCOUT APM
    case 'scout_list_apps': return scoutAPI('/apps');
    case 'scout_get_app_endpoints': return scoutAPI(`/apps/${args.app_id}/endpoints?from=${args.from_}&to=${args.to}`);
    case 'scout_get_insights': {
      let url = `/apps/${args.app_id}/insights`;
      if (args.insight_type) url += `?type=${args.insight_type}`;
      if (args.limit) url += `${args.insight_type ? '&' : '?'}limit=${args.limit}`;
      return scoutAPI(url);
    }
    case 'scout_get_error_groups': return scoutAPI(`/apps/${args.app_id}/error_groups?from=${args.from_}&to=${args.to}`);

    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ========== API HELPERS ==========

async function githubAPI(path, method = 'GET', body = null) {
  if (!GITHUB_TOKEN) return { error: 'GITHUB_TOKEN not configured' };
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { success: true };
  return res.json();
}

async function flyGraphQL(query) {
  if (!FLY_API_TOKEN) return { error: 'FLY_API_TOKEN not configured' };
  const res = await fetch('https://api.fly.io/graphql', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FLY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function flyLogsAPI(appName, lines) {
  if (!FLY_API_TOKEN) return { error: 'FLY_API_TOKEN not configured' };
  // Get machines first
  const appData = await flyGraphQL(`query { app(name: "${appName}") { machines { nodes { id } } } }`);
  if (!appData.data?.app?.machines?.nodes?.length) return { error: 'No machines found' };
  const machineId = appData.data.app.machines.nodes[0].id;
  
  const res = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machineId}/logs?limit=${lines}`, {
    headers: { 'Authorization': `Bearer ${FLY_API_TOKEN}` }
  });
  return res.json();
}

async function flyRestartApp(appName) {
  if (!FLY_API_TOKEN) return { error: 'FLY_API_TOKEN not configured' };
  const appData = await flyGraphQL(`query { app(name: "${appName}") { machines { nodes { id } } } }`);
  if (!appData.data?.app?.machines?.nodes?.length) return { error: 'No machines found' };
  
  const results = [];
  for (const machine of appData.data.app.machines.nodes) {
    const res = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines/${machine.id}/restart`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FLY_API_TOKEN}` }
    });
    results.push({ machine: machine.id, status: res.status });
  }
  return { restarted: results };
}

async function cfAPI(path, method = 'GET', body = null) {
  if (!CF_API_KEY) return { error: 'CF_API_KEY not configured' };
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function n8nAPI(path, method = 'GET', body = null) {
  if (!N8N_API_KEY) return { error: 'N8N_API_KEY not configured' };
  const res = await fetch(`${N8N_BASE_URL}${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function scoutAPI(path) {
  if (!SCOUT_API_KEY) return { error: 'SCOUT_API_KEY not configured' };
  const res = await fetch(`https://scoutapm.com/api/v1${path}`, {
    headers: { 'Authorization': `Bearer ${SCOUT_API_KEY}` }
  });
  return res.json();
}

async function healthCheckAll() {
  const results = {};
  const checks = Object.entries(MCP_ENDPOINTS).map(async ([name, url]) => {
    try {
      const start = Date.now();
      const res = await fetch(url, { timeout: 5000 });
      const latency = Date.now() - start;
      results[name] = { status: res.ok ? 'up' : 'down', code: res.status, latency: `${latency}ms` };
    } catch (err) {
      results[name] = { status: 'down', error: err.message };
    }
  });
  await Promise.all(checks);
  const up = Object.values(results).filter(r => r.status === 'up').length;
  return { summary: `${up}/${Object.keys(results).length} up`, endpoints: results };
}

function execSSH(hostAlias, command, timeout) {
  return new Promise((resolve) => {
    const hostConfig = SSH_HOSTS[hostAlias];
    if (!hostConfig) return resolve({ error: `Unknown host: ${hostAlias}`, available: Object.keys(SSH_HOSTS) });
    if (!SSH_PRIVATE_KEY) return resolve({ error: 'SSH_PRIVATE_KEY not configured' });

    const conn = new Client();
    let output = '';
    const timer = setTimeout(() => { conn.end(); resolve({ error: 'SSH timeout', output }); }, timeout);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); return resolve({ error: err.message }); }
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', (data) => { output += data.toString(); });
        stream.on('close', () => { clearTimeout(timer); conn.end(); resolve({ output: output.trim() }); });
      });
    }).on('error', (err) => { clearTimeout(timer); resolve({ error: err.message }); })
    .connect({ host: hostConfig.host, username: hostConfig.username, privateKey: SSH_PRIVATE_KEY });
  });
}

// ========== ROUTES ==========

app.get('/health', (req, res) => res.json({ status: 'ok', server: 'lrlab-mcp-v3', tools: TOOLS.length }));

app.get('/sse', (req, res) => {
  if (req.query.key !== MCP_KEY) return res.status(401).json({ error: 'Invalid key' });
  const clientId = randomUUID();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  clients.set(clientId, res);
  res.write(`event: endpoint\ndata: /message/${clientId}\n\n`);
  req.on('close', () => clients.delete(clientId));
});

app.post('/message/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const sseClient = clients.get(clientId);
  if (!sseClient) return res.status(404).json({ error: 'Client not found' });

  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', serverInfo: { name: 'lrlab-mcp', version: '3.0.0' }, capabilities: { tools: {} } };
        break;
      case 'notifications/initialized':
        return res.status(202).json({ status: 'ok' });
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call':
        const content = await handleTool(params.name, params.arguments || {});
        result = { content: [{ type: 'text', text: JSON.stringify(content, null, 2) }] };
        break;
      default:
        result = {};
    }
    sseClient.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
    res.status(202).json({ status: 'accepted' });
  } catch (err) {
    sseClient.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } })}\n\n`);
    res.status(202).json({ status: 'accepted' });
  }
});

app.listen(PORT, () => console.log(`lrlab-mcp v3 running on port ${PORT} with ${TOOLS.length} tools`));
