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

const clients = new Map();

const SSH_HOSTS = {
  garzahive: { host: '143.198.190.20', username: 'root' },
  mac: { host: 'ssh.garzahive.com', username: 'customer' },
  n8n: { host: '167.172.147.240', username: 'root' }
};

const TOOLS = [
  {
    name: 'ping',
    description: 'Health check - returns pong with timestamp',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'ssh_exec',
    description: 'Execute command via SSH. Hosts: garzahive, mac, n8n',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'SSH host alias' },
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms' }
      },
      required: ['host', 'command']
    }
  },
  {
    name: 'ssh_hosts',
    description: 'List available SSH host aliases',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'github_list_repos',
    description: 'List repos for user/org (default: garza-os)',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'User or org name', default: 'itsablabla' },
        per_page: { type: 'number', default: 30 }
      },
      required: []
    }
  },
  {
    name: 'github_get_repo',
    description: 'Get repository details',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' }
      },
      required: ['owner', 'repo']
    }
  },
  {
    name: 'github_list_issues',
    description: 'List issues (open/closed/all)',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' }
      },
      required: ['owner', 'repo']
    }
  },
  {
    name: 'github_create_issue',
    description: 'Create issue with title, body, labels',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } }
      },
      required: ['owner', 'repo', 'title']
    }
  },
  {
    name: 'github_create_repo',
    description: 'Create new repo (personal or org, private default)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        private: { type: 'boolean', default: true },
        org: { type: 'string', description: 'Org name (optional)' }
      },
      required: ['name']
    }
  },
  {
    name: 'scout_list_apps',
    description: '[Scout APM] List monitored applications',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'scout_get_app_endpoints',
    description: '[Scout APM] Get endpoints with performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'integer' },
        from_: { type: 'string' },
        to: { type: 'string' }
      },
      required: ['app_id', 'from_', 'to']
    }
  },
  {
    name: 'scout_get_insights',
    description: '[Scout APM] N+1 queries, memory bloat, slow queries',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'integer' },
        insight_type: { type: 'string' },
        limit: { type: 'integer' }
      },
      required: ['app_id']
    }
  },
  {
    name: 'scout_get_error_groups',
    description: '[Scout APM] Recent error groups',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'integer' },
        from_: { type: 'string' },
        to: { type: 'string' }
      },
      required: ['app_id', 'from_', 'to']
    }
  }
];

// Tool handlers
async function handleTool(name, args) {
  switch (name) {
    case 'ping':
      return { status: 'pong', timestamp: new Date().toISOString(), server: 'lrlab-mcp-v2' };

    case 'ssh_hosts':
      return { hosts: Object.keys(SSH_HOSTS), config: SSH_HOSTS };

    case 'ssh_exec':
      return execSSH(args.host, args.command, args.timeout || 30000);

    case 'github_list_repos':
      return githubAPI(`/users/${args.owner || 'itsablabla'}/repos?per_page=${args.per_page || 30}`);

    case 'github_get_repo':
      return githubAPI(`/repos/${args.owner}/${args.repo}`);

    case 'github_list_issues':
      return githubAPI(`/repos/${args.owner}/${args.repo}/issues?state=${args.state || 'open'}`);

    case 'github_create_issue':
      return githubAPI(`/repos/${args.owner}/${args.repo}/issues`, 'POST', {
        title: args.title,
        body: args.body,
        labels: args.labels
      });

    case 'github_create_repo':
      const endpoint = args.org ? `/orgs/${args.org}/repos` : '/user/repos';
      return githubAPI(endpoint, 'POST', {
        name: args.name,
        description: args.description,
        private: args.private !== false
      });

    case 'scout_list_apps':
      return scoutAPI('/apps');

    case 'scout_get_app_endpoints':
      return scoutAPI(`/apps/${args.app_id}/endpoints?from=${args.from_}&to=${args.to}`);

    case 'scout_get_insights':
      let url = `/apps/${args.app_id}/insights`;
      if (args.insight_type) url += `?type=${args.insight_type}`;
      if (args.limit) url += `${args.insight_type ? '&' : '?'}limit=${args.limit}`;
      return scoutAPI(url);

    case 'scout_get_error_groups':
      return scoutAPI(`/apps/${args.app_id}/error_groups?from=${args.from_}&to=${args.to}`);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function githubAPI(path, method = 'GET', body = null) {
  if (!GITHUB_TOKEN) return { error: 'GITHUB_TOKEN not configured' };
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
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

function execSSH(hostAlias, command, timeout) {
  return new Promise((resolve) => {
    const hostConfig = SSH_HOSTS[hostAlias];
    if (!hostConfig) {
      resolve({ error: `Unknown host: ${hostAlias}`, available: Object.keys(SSH_HOSTS) });
      return;
    }
    if (!SSH_PRIVATE_KEY) {
      resolve({ error: 'SSH_PRIVATE_KEY not configured' });
      return;
    }

    const conn = new Client();
    let output = '';
    const timer = setTimeout(() => {
      conn.end();
      resolve({ error: 'SSH timeout', output });
    }, timeout);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolve({ error: err.message });
          return;
        }
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', (data) => { output += data.toString(); });
        stream.on('close', () => {
          clearTimeout(timer);
          conn.end();
          resolve({ output: output.trim() });
        });
      });
    }).on('error', (err) => {
      clearTimeout(timer);
      resolve({ error: err.message });
    }).connect({
      host: hostConfig.host,
      username: hostConfig.username,
      privateKey: SSH_PRIVATE_KEY
    });
  });
}

// Health endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', server: 'lrlab-mcp-v2' }));

// SSE endpoint
app.get('/sse', (req, res) => {
  if (req.query.key !== MCP_KEY) {
    return res.status(401).json({ error: 'Invalid key' });
  }

  const clientId = randomUUID();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.set(clientId, res);
  res.write(`event: endpoint\ndata: /message/${clientId}\n\n`);

  req.on('close', () => clients.delete(clientId));
});

// Message endpoint - sends response via SSE stream
app.post('/message/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const sseClient = clients.get(clientId);
  if (!sseClient) return res.status(404).json({ error: 'Client not found' });

  const { method, params, id } = req.body;

  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'lrlab-mcp', version: '2.0.0' },
          capabilities: { tools: {} }
        };
        break;
      case 'notifications/initialized':
        // Notification, no response needed
        res.status(202).json({ status: 'ok' });
        return;
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
    
    // Send response via SSE stream
    const response = { jsonrpc: '2.0', id, result };
    sseClient.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    
    // Acknowledge POST
    res.status(202).json({ status: 'accepted' });
  } catch (err) {
    const errorResponse = { jsonrpc: '2.0', id, error: { code: -32000, message: err.message } };
    sseClient.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
    res.status(202).json({ status: 'accepted' });
  }
});

app.listen(PORT, () => console.log(`lrlab-mcp running on port ${PORT}`));
