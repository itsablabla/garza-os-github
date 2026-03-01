import { Hono } from 'hono';
import { serve } from '@hono/node-server';
// ============================================================
// GARZA OS DEV MCP GATEWAY v1.0
// Stack: last-rock-labs (development / business)
// Categories: vaults, infrastructure, automation, ai_ops, web_dev, analytics, database
// URL: https://garza-dev-gateway-production.up.railway.app
// ============================================================
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || 'garza-dev-2025';
const PORT = parseInt(process.env.PORT || '8080');
const DOPPLER_TOKEN = process.env.DOPPLER_TOKEN || '';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  backend: BackendDef;
}
interface BackendDef {
  type: 'http' | 'npx' | 'direct';
  url?: string;
  authHeader?: string;
  authEnvKey?: string;
  authValue?: string;
  originalMethod: string;
}

const creds: Record<string, string> = {};

async function loadCredentials(): Promise<void> {
  const envKeys = [
    'DOPPLER_TOKEN', 'BITWARDEN_MCP_API_KEY',
    'GITHUB_TOKEN', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN',
    'RAILWAY_TOKEN', 'DIGITALOCEAN_TOKEN',
    'N8N_MCP_TOKEN', 'ACTIVEPIECES_API_KEY',
    'COMPOSIO_API_KEY', 'RUBE_MCP_TOKEN', 'TASKR_API_KEY',
    'FIRECRAWL_API_KEY', 'BRIGHTDATA_API_TOKEN', 'OLOSTEP_API_KEY',
    'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
    'DIFY_API_KEY', 'FLOWISE_API_KEY',
    'GRAFANA_TOKEN', 'POSTGRES_URL',
    'NOCODB_API_KEY', 'BASEROW_API_KEY',
    'E2B_API_KEY', 'REPLIT_API_KEY',
    'GRAPHITI_TOKEN', 'MEM0_API_KEY',
    'CONTEXT7_TOKEN',
  ];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) creds[key] = val;
  }
  if (DOPPLER_TOKEN) {
    try {
      const projects = ['garza', 'garza-os'];
      for (const proj of projects) {
        const res = await fetch(
          `https://api.doppler.com/v3/configs/config/secrets?project=${proj}&config=prd`,
          { headers: { Authorization: `Bearer ${DOPPLER_TOKEN}` } }
        );
        if (res.ok) {
          const data = await res.json() as any;
          const secrets = data.secrets || {};
          for (const [k, v] of Object.entries(secrets)) {
            const val = (v as any)?.raw;
            if (val && !creds[k]) creds[k] = val;
          }
        }
      }
      console.log(`✓ Loaded ${Object.keys(creds).length} credentials from Doppler`);
    } catch (e) {
      console.error('Doppler load error:', e);
    }
  }
}

function getCred(key: string): string {
  return creds[key] || process.env[key] || '';
}

async function callHttpTool(backend: BackendDef, args: any): Promise<any> {
  const url = backend.url!;
  const authVal = backend.authValue || getCred(backend.authEnvKey || '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (backend.authHeader && authVal) {
    headers[backend.authHeader] = authVal.startsWith('Bearer ') ? authVal : `Bearer ${authVal}`;
  }
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'tools/call',
    params: { name: backend.originalMethod, arguments: args }
  });
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (text.includes('data: ')) {
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.result) return parsed.result;
      } catch {}
    }
  }
  try { return JSON.parse(text); } catch { return { content: [{ type: 'text', text }] }; }
}

async function buildTools(): Promise<ToolDef[]> {
  const tools: ToolDef[] = [];

  // ============================================================
  // VAULTS
  // ============================================================
  tools.push({
    name: 'vaults.secrets.get',
    description: 'Retrieve a specific secret from Doppler. Use to fetch API keys, tokens, and credentials for dev/infra services.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', default: 'garza-os' }, config: { type: 'string', default: 'prd' }, name: { type: 'string' } }, required: ['name'] },
    backend: { type: 'direct', originalMethod: 'get_secret' }
  });
  tools.push({
    name: 'vaults.secrets.list',
    description: 'List all secret names in a Doppler project config.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', default: 'garza-os' }, config: { type: 'string', default: 'prd' } } },
    backend: { type: 'direct', originalMethod: 'list_secrets' }
  });
  tools.push({
    name: 'vaults.passwords.search',
    description: 'Search Bitwarden vault for credentials by name or URL.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    backend: { type: 'http', url: 'https://bitwarden-nomadprime.replit.app/mcp', authHeader: 'Authorization', authEnvKey: 'BITWARDEN_MCP_API_KEY', originalMethod: 'search_vault' }
  });

  // ============================================================
  // INFRASTRUCTURE — GitHub, Cloudflare, Vercel, Railway, DigitalOcean
  // ============================================================
  tools.push({
    name: 'infrastructure.github.create_pr',
    description: 'Create a GitHub pull request. Use to submit code changes for review.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, head: { type: 'string' }, base: { type: 'string', default: 'main' } }, required: ['owner', 'repo', 'title', 'head'] },
    backend: { type: 'npx', originalMethod: 'create_pull_request' }
  });
  tools.push({
    name: 'infrastructure.github.list_repos',
    description: 'List GitHub repositories for a user or organization.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, type: { type: 'string', enum: ['all', 'public', 'private'], default: 'all' } } },
    backend: { type: 'npx', originalMethod: 'list_repositories' }
  });
  tools.push({
    name: 'infrastructure.github.create_issue',
    description: 'Create a GitHub issue for bug tracking or feature requests.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['owner', 'repo', 'title'] },
    backend: { type: 'npx', originalMethod: 'create_issue' }
  });
  tools.push({
    name: 'infrastructure.github.search_code',
    description: 'Search code across GitHub repositories.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'search_code' }
  });
  tools.push({
    name: 'infrastructure.cloudflare.query_d1',
    description: 'Execute a SQL query against a Cloudflare D1 database.',
    inputSchema: { type: 'object', properties: { database_id: { type: 'string' }, sql: { type: 'string' }, params: { type: 'array' } }, required: ['database_id', 'sql'] },
    backend: { type: 'npx', originalMethod: 'query' }
  });
  tools.push({
    name: 'infrastructure.cloudflare.list_kv',
    description: 'List keys in a Cloudflare KV namespace.',
    inputSchema: { type: 'object', properties: { namespace_id: { type: 'string' }, prefix: { type: 'string' } }, required: ['namespace_id'] },
    backend: { type: 'npx', originalMethod: 'list_kv_keys' }
  });
  tools.push({
    name: 'infrastructure.cloudflare.r2_list',
    description: 'List objects in a Cloudflare R2 storage bucket.',
    inputSchema: { type: 'object', properties: { bucket: { type: 'string' }, prefix: { type: 'string' } }, required: ['bucket'] },
    backend: { type: 'npx', originalMethod: 'list_r2_objects' }
  });
  tools.push({
    name: 'infrastructure.vercel.list_deployments',
    description: 'List recent Vercel deployments for a project.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, limit: { type: 'number', default: 10 } } },
    backend: { type: 'npx', originalMethod: 'list_deployments' }
  });
  tools.push({
    name: 'infrastructure.railway.list_services',
    description: 'List all Railway services across projects.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } } },
    backend: { type: 'npx', originalMethod: 'list_services' }
  });
  tools.push({
    name: 'infrastructure.digitalocean.list_droplets',
    description: 'List all DigitalOcean Droplets (VMs).',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'npx', originalMethod: 'list_droplets' }
  });
  tools.push({
    name: 'infrastructure.replit.run_code',
    description: 'Run code in a Replit environment. Use for quick code execution and testing.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string', default: 'python' } }, required: ['code'] },
    backend: { type: 'http', url: 'https://replit.com/api/v1/mcp', authHeader: 'Authorization', authEnvKey: 'REPLIT_API_KEY', originalMethod: 'run_code' }
  });
  tools.push({
    name: 'infrastructure.e2b.run_sandbox',
    description: 'Run code in an E2B secure sandbox. Use for isolated code execution.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string', default: 'python' }, timeout: { type: 'number', default: 30 } }, required: ['code'] },
    backend: { type: 'npx', originalMethod: 'run_code' }
  });

  // ============================================================
  // AUTOMATION — n8n, ActivePieces, Composio, Rube, Taskr
  // ============================================================
  tools.push({
    name: 'automation.n8n.list_workflows',
    description: 'List all n8n automation workflows. Use to see what automations are available.',
    inputSchema: { type: 'object', properties: { active: { type: 'boolean' } } },
    backend: { type: 'http', url: 'https://primary-production-f10f7.up.railway.app/mcp-server/http', authHeader: 'Authorization', authEnvKey: 'N8N_MCP_TOKEN', originalMethod: 'n8n_list_workflows' }
  });
  tools.push({
    name: 'automation.n8n.execute_workflow',
    description: 'Execute an n8n workflow by ID with optional input data.',
    inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' }, data: { type: 'object' } }, required: ['workflow_id'] },
    backend: { type: 'http', url: 'https://primary-production-f10f7.up.railway.app/mcp-server/http', authHeader: 'Authorization', authEnvKey: 'N8N_MCP_TOKEN', originalMethod: 'n8n_run_workflow' }
  });
  tools.push({
    name: 'automation.activepieces.list_flows',
    description: 'List all ActivePieces automation flows.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://automation.garzahive.com/api/v1/mcp', authHeader: 'Authorization', authEnvKey: 'ACTIVEPIECES_API_KEY', originalMethod: 'list_flows' }
  });
  tools.push({
    name: 'automation.composio.list_tools',
    description: 'List all available Composio tools and integrations.',
    inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'Filter by app name (e.g. github, slack, notion)' } } },
    backend: { type: 'http', url: 'https://backend.composio.dev/v3/mcp/8ff85b1c-a8c2-4e1a-bf44-28a0e7116407?user_id=default', authHeader: 'x-api-key', authEnvKey: 'COMPOSIO_API_KEY', originalMethod: 'tools/list' }
  });
  tools.push({
    name: 'automation.rube.run',
    description: 'Execute a Rube automation task.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, params: { type: 'object' } }, required: ['task'] },
    backend: { type: 'http', url: 'https://rube.app/mcp', authHeader: 'Authorization', authEnvKey: 'RUBE_MCP_TOKEN', originalMethod: 'run_task' }
  });
  tools.push({
    name: 'automation.taskr.list_tasks',
    description: 'List tasks in Taskr project management.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, status: { type: 'string' } } },
    backend: { type: 'http', url: 'https://www.taskr.one/api/mcp', authHeader: 'Authorization', authEnvKey: 'TASKR_API_KEY', originalMethod: 'list_tasks' }
  });
  tools.push({
    name: 'automation.taskr.create_task',
    description: 'Create a new task in Taskr.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, project_id: { type: 'string' }, description: { type: 'string' }, due_date: { type: 'string' } }, required: ['title'] },
    backend: { type: 'http', url: 'https://www.taskr.one/api/mcp', authHeader: 'Authorization', authEnvKey: 'TASKR_API_KEY', originalMethod: 'create_task' }
  });

  // ============================================================
  // AI OPS — Langfuse, Dify, Flowise, Flujo, Graphiti
  // ============================================================
  tools.push({
    name: 'ai_ops.observability.list_traces',
    description: 'List LLM traces from Langfuse for AI observability and debugging.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 }, from_timestamp: { type: 'string' } } },
    backend: { type: 'http', url: 'https://langfuse-web-production-20d9.up.railway.app/api/public/mcp', authHeader: 'Authorization', authEnvKey: 'LANGFUSE_SECRET_KEY', originalMethod: 'list_traces' }
  });
  tools.push({
    name: 'ai_ops.observability.get_trace',
    description: 'Get detailed information about a specific Langfuse trace including all spans and LLM calls.',
    inputSchema: { type: 'object', properties: { trace_id: { type: 'string' } }, required: ['trace_id'] },
    backend: { type: 'http', url: 'https://langfuse-web-production-20d9.up.railway.app/api/public/mcp', authHeader: 'Authorization', authEnvKey: 'LANGFUSE_SECRET_KEY', originalMethod: 'get_trace' }
  });
  tools.push({
    name: 'ai_ops.dify.list_apps',
    description: 'List all Dify AI applications.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://web-production-c6144.up.railway.app/v1/mcp', authHeader: 'Authorization', authEnvKey: 'DIFY_API_KEY', originalMethod: 'list_apps' }
  });
  tools.push({
    name: 'ai_ops.flowise.list_chatflows',
    description: 'List all Flowise chatflows and AI pipelines.',
    inputSchema: { type: 'object', properties: {} },
    backend: { type: 'http', url: 'https://flowise-production.up.railway.app/api/v1/mcp', authHeader: 'Authorization', authEnvKey: 'FLOWISE_API_KEY', originalMethod: 'list_chatflows' }
  });
  tools.push({
    name: 'ai_ops.graphiti.search',
    description: 'Search the Graphiti knowledge graph for entities and relationships.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, num_results: { type: 'number', default: 5 } }, required: ['query'] },
    backend: { type: 'http', url: 'https://graphiti-mcp-production.up.railway.app/mcp', authHeader: 'Authorization', authEnvKey: 'GRAPHITI_TOKEN', originalMethod: 'search' }
  });
  tools.push({
    name: 'ai_ops.memory.search',
    description: 'Search Mem0 AI memory for relevant context and past interactions.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, user_id: { type: 'string', default: 'jaden' } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'search_memory' }
  });
  tools.push({
    name: 'ai_ops.reasoning.think',
    description: 'Sequential thinking for complex problem decomposition and multi-step reasoning.',
    inputSchema: { type: 'object', properties: { thought: { type: 'string' }, next_thought_needed: { type: 'boolean' }, thought_number: { type: 'number' }, total_thoughts: { type: 'number' } }, required: ['thought', 'next_thought_needed', 'thought_number', 'total_thoughts'] },
    backend: { type: 'npx', originalMethod: 'sequentialthinking' }
  });
  tools.push({
    name: 'ai_ops.context.resolve_library_docs',
    description: 'Resolve up-to-date documentation for any library or framework. Use before coding to get the latest API docs.',
    inputSchema: { type: 'object', properties: { libraryName: { type: 'string' }, tokens: { type: 'number', default: 10000 } }, required: ['libraryName'] },
    backend: { type: 'npx', originalMethod: 'resolve-library-id' }
  });

  // ============================================================
  // ANALYTICS — Grafana, Plausible, Metabase
  // ============================================================
  tools.push({
    name: 'analytics.grafana.list_dashboards',
    description: 'List all Grafana monitoring dashboards.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    backend: { type: 'http', url: 'https://grafana-production.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'GRAFANA_TOKEN', originalMethod: 'list_dashboards' }
  });
  tools.push({
    name: 'analytics.grafana.query_datasource',
    description: 'Query a Grafana datasource (Prometheus, InfluxDB, etc.) for metrics.',
    inputSchema: { type: 'object', properties: { datasource_uid: { type: 'string' }, query: { type: 'string' }, from: { type: 'string', default: 'now-1h' }, to: { type: 'string', default: 'now' } }, required: ['datasource_uid', 'query'] },
    backend: { type: 'http', url: 'https://grafana-production.up.railway.app/api/mcp', authHeader: 'Authorization', authEnvKey: 'GRAFANA_TOKEN', originalMethod: 'query_datasource' }
  });

  // ============================================================
  // DATABASE — Postgres, NocoDB, Baserow
  // ============================================================
  tools.push({
    name: 'database.postgres.query',
    description: 'Execute a SQL query against the Postgres database.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    backend: { type: 'npx', originalMethod: 'query' }
  });
  tools.push({
    name: 'database.nocodb.list_tables',
    description: 'List all tables in a NocoDB base.',
    inputSchema: { type: 'object', properties: { base_id: { type: 'string' } }, required: ['base_id'] },
    backend: { type: 'http', url: 'https://nocodb-production.up.railway.app/api/v1/mcp', authHeader: 'xc-token', authEnvKey: 'NOCODB_API_KEY', originalMethod: 'list_tables' }
  });
  tools.push({
    name: 'database.nocodb.get_records',
    description: 'Get records from a NocoDB table.',
    inputSchema: { type: 'object', properties: { table_id: { type: 'string' }, where: { type: 'string' }, limit: { type: 'number', default: 25 } }, required: ['table_id'] },
    backend: { type: 'http', url: 'https://nocodb-production.up.railway.app/api/v1/mcp', authHeader: 'xc-token', authEnvKey: 'NOCODB_API_KEY', originalMethod: 'list_records' }
  });
  tools.push({
    name: 'database.baserow.list_tables',
    description: 'List all tables in a Baserow database.',
    inputSchema: { type: 'object', properties: { database_id: { type: 'number' } }, required: ['database_id'] },
    backend: { type: 'http', url: 'https://api.baserow.io/api/mcp', authHeader: 'Authorization', authEnvKey: 'BASEROW_API_KEY', originalMethod: 'list_tables' }
  });

  // ============================================================
  // WEB — Firecrawl, Bright Data, Olostep, Playwright
  // ============================================================
  tools.push({
    name: 'web.scraping.scrape',
    description: 'Scrape a webpage and return clean Markdown content. Use for reading documentation, articles, or any public web content.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, formats: { type: 'array', items: { type: 'string' }, default: ['markdown'] } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'firecrawl_scrape' }
  });
  tools.push({
    name: 'web.scraping.crawl',
    description: 'Crawl an entire website and extract content from all pages.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, max_pages: { type: 'number', default: 10 } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'firecrawl_crawl' }
  });
  tools.push({
    name: 'web.scraping.brightdata',
    description: 'Scrape websites using Bright Data residential proxies. Use for sites that block standard scrapers.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'scrape_as_markdown' }
  });
  tools.push({
    name: 'web.browser.navigate',
    description: 'Navigate a headless browser to a URL and interact with the page.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    backend: { type: 'npx', originalMethod: 'browser_navigate' }
  });
  tools.push({
    name: 'web.filesystem.read',
    description: 'Read a file from the local filesystem.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    backend: { type: 'npx', originalMethod: 'read_file' }
  });

  return tools;
}

async function executeTool(tool: ToolDef, args: any): Promise<any> {
  const { backend } = tool;

  if (tool.name === 'vaults.secrets.get') {
    const project = args.project || 'garza-os';
    const config = args.config || 'prd';
    const name = args.name;
    const token = getCred('DOPPLER_TOKEN');
    const res = await fetch(
      `https://api.doppler.com/v3/configs/config/secret?project=${project}&config=${config}&name=${name}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    return { content: [{ type: 'text', text: JSON.stringify({ name, value: data?.secret?.raw || 'NOT_FOUND' }) }] };
  }

  if (tool.name === 'vaults.secrets.list') {
    const project = args.project || 'garza-os';
    const config = args.config || 'prd';
    const token = getCred('DOPPLER_TOKEN');
    const res = await fetch(
      `https://api.doppler.com/v3/configs/config/secrets?project=${project}&config=${config}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json() as any;
    const names = Object.keys(data?.secrets || {});
    return { content: [{ type: 'text', text: JSON.stringify({ count: names.length, secrets: names }) }] };
  }

  if (backend.type === 'http') {
    return await callHttpTool(backend, args);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        tool: tool.name,
        method: backend.originalMethod,
        args,
        note: 'This tool requires the local npx package. Configure the individual MCP server in your client for direct access.',
        status: 'proxy_required'
      })
    }]
  };
}

const app = new Hono();

function authMiddleware(c: any, next: any) {
  const auth = c.req.header('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (token !== GATEWAY_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
}

let toolRegistry: ToolDef[] = [];

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    gateway: 'GARZA OS Dev MCP Gateway',
    version: '1.0.0',
    stack: 'last-rock-labs',
    tools_count: toolRegistry.length,
    categories: [...new Set(toolRegistry.map(t => t.name.split('.')[0]))],
  });
});

app.post('/mcp', authMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const { method, params, id } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'GARZA OS Dev MCP Gateway', version: '1.0.0' }
      }
    });
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0', id,
      result: {
        tools: toolRegistry.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      }
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const tool = toolRegistry.find(t => t.name === toolName);
    if (!tool) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${toolName}` } });
    }
    try {
      const result = await executeTool(tool, toolArgs);
      return c.json({ jsonrpc: '2.0', id, result });
    } catch (e: any) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
    }
  }

  if (method === 'notifications/initialized') {
    return c.json({ jsonrpc: '2.0', id, result: {} });
  }

  return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
});

loadCredentials().then(async () => {
  toolRegistry = await buildTools();
  console.log(`\n🔐 GARZA OS Dev MCP Gateway v1.0.0`);
  console.log(`📦 Stack: last-rock-labs (development/business)`);
  console.log(`🛠  Tools: ${toolRegistry.length}`);
  const cats = [...new Set(toolRegistry.map(t => t.name.split('.')[0]))];
  for (const cat of cats) {
    const count = toolRegistry.filter(t => t.name.startsWith(cat + '.')).length;
    console.log(`   ${cat}: ${count} tools`);
  }
  console.log(`🚀 Listening on port ${PORT}\n`);
  serve({ fetch: app.fetch, port: PORT });
});
