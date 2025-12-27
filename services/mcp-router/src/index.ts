import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Types
interface MCPServer {
  id: string;
  name: string;
  description: string;
  url: string;
  auth_key: string | null;
  enabled: boolean;
  priority: number;
  health_status: string;
  tool_manifest: any;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  _server?: string;
  _serverId?: string;
}

// Environment
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vbwhhmdudzigolwhklal.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY!;
const ROUTER_API_KEY = process.env.ROUTER_API_KEY || 'garza-mcp-router-2025';
const PORT = parseInt(process.env.PORT || '8080');

// Initialize Supabase
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// Cache for aggregated tools
let toolCache: Map<string, { tool: Tool; serverId: string; serverUrl: string; serverAuthKey: string | null }> = new Map();
let serverCache: MCPServer[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60000;

const app = new Hono();

// Auth middleware for SSE
app.use('/sse', async (c, next) => {
  const url = new URL(c.req.url);
  const key = url.searchParams.get('key');
  if (key !== ROUTER_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// Fetch enabled MCP servers
async function getEnabledServers(): Promise<MCPServer[]> {
  const { data, error } = await supabase
    .from('mcp_servers')
    .select('*')
    .eq('enabled', true)
    .order('priority', { ascending: true });
  if (error) {
    console.error('Error fetching servers:', error);
    return [];
  }
  return data || [];
}

// Parse tools from a server's manifest
function parseToolsFromManifest(server: MCPServer): Tool[] {
  if (!server.tool_manifest?.tools) return [];
  return server.tool_manifest.tools.map((t: Tool) => ({
    ...t,
    name: `${server.name}:${t.name}`,
    _server: server.name,
    _serverId: server.id
  }));
}

// Aggregate all tools
async function aggregateTools(): Promise<void> {
  const now = Date.now();
  if (now - lastCacheUpdate < CACHE_TTL && toolCache.size > 0) return;
  
  serverCache = await getEnabledServers();
  const newCache = new Map();
  
  for (const server of serverCache) {
    const tools = parseToolsFromManifest(server);
    for (const tool of tools) {
      newCache.set(tool.name, {
        tool,
        serverId: server.id,
        serverUrl: server.url,
        serverAuthKey: server.auth_key
      });
    }
  }
  
  toolCache = newCache;
  lastCacheUpdate = now;
  console.log(`Cached ${toolCache.size} tools from ${serverCache.length} servers`);
}

// Forward tool call to target server via HTTP POST
async function forwardToolCall(toolName: string, args: any): Promise<any> {
  const toolInfo = toolCache.get(toolName);
  if (!toolInfo) throw new Error(`Unknown tool: ${toolName}`);
  
  const originalName = toolName.split(':').slice(1).join(':');
  const baseUrl = toolInfo.serverUrl.replace('/sse', '');
  const callUrl = `${baseUrl}/call`;
  
  console.log(`Forwarding ${originalName} to ${callUrl}`);
  
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (toolInfo.serverAuthKey) {
    headers['Authorization'] = `Bearer ${toolInfo.serverAuthKey}`;
  }
  
  const response = await fetch(callUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool: originalName, arguments: args })
  });
  
  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }
  
  return response.json();
}

// SSE endpoint
app.get('/sse', async (c) => {
  await aggregateTools();
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const sessionId = uuidv4();
      const endpoint = `/message?session=${sessionId}`;
      
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
      
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 30000);
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  });
});

// MCP message handler
app.post('/message', async (c) => {
  const body = await c.req.json();
  console.log('Message:', body.method);
  
  if (body.method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'GARZA MCP Router', version: '1.0.0' }
      }
    });
  }
  
  if (body.method === 'tools/list') {
    await aggregateTools();
    const tools = Array.from(toolCache.values()).map(({ tool }) => ({
      name: tool.name,
      description: `[${tool._server}] ${tool.description || ''}`,
      inputSchema: tool.inputSchema
    }));
    return c.json({ jsonrpc: '2.0', id: body.id, result: { tools } });
  }
  
  if (body.method === 'tools/call') {
    const { name, arguments: args } = body.params;
    try {
      const result = await forwardToolCall(name, args);
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      });
    } catch (error: any) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32603, message: error.message }
      });
    }
  }
  
  return c.json({ jsonrpc: '2.0', id: body.id, result: {} });
});

// Health
app.get('/health', (c) => c.json({ status: 'ok', tools: toolCache.size, servers: serverCache.length }));

// Admin: List servers
app.get('/api/servers', async (c) => {
  const servers = await getEnabledServers();
  return c.json({ servers });
});

// Admin: Add server
app.post('/api/servers', async (c) => {
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('mcp_servers')
    .insert({
      name: body.name,
      description: body.description,
      url: body.url,
      auth_key: body.auth_key,
      enabled: body.enabled ?? true,
      priority: body.priority ?? 100,
      tool_manifest: body.tool_manifest
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  lastCacheUpdate = 0;
  return c.json({ server: data });
});

// Admin: Update server
app.patch('/api/servers/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { data, error } = await supabase.from('mcp_servers').update(body).eq('id', id).select().single();
  if (error) return c.json({ error: error.message }, 400);
  lastCacheUpdate = 0;
  return c.json({ server: data });
});

// Admin: Delete server
app.delete('/api/servers/:id', async (c) => {
  const id = c.req.param('id');
  const { error } = await supabase.from('mcp_servers').delete().eq('id', id);
  if (error) return c.json({ error: error.message }, 400);
  lastCacheUpdate = 0;
  return c.json({ success: true });
});

// Admin: Refresh cache
app.post('/api/refresh', async (c) => {
  lastCacheUpdate = 0;
  await aggregateTools();
  return c.json({ tools: Array.from(toolCache.keys()), count: toolCache.size });
});

console.log(`🚀 GARZA MCP Router on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
