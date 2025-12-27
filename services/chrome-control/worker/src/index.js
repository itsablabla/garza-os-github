// Chrome Control Remote MCP Server
// Cloudflare Worker with Durable Objects for WebSocket management

const TOOLS = [
  {
    name: 'open_url',
    description: 'Open a URL in Chrome',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' },
        new_tab: { type: 'boolean', description: 'Open in a new tab', default: true }
      },
      required: ['url']
    }
  },
  {
    name: 'get_current_tab',
    description: 'Get information about the current active tab',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_tabs',
    description: 'List all open tabs in Chrome',
    inputSchema: {
      type: 'object',
      properties: {
        window_id: { type: 'number', description: 'Specific window ID to list tabs from' }
      }
    }
  },
  {
    name: 'close_tab',
    description: 'Close a specific tab',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'ID of the tab to close' } },
      required: ['tab_id']
    }
  },
  {
    name: 'switch_to_tab',
    description: 'Switch to a specific tab',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'ID of the tab to switch to' } },
      required: ['tab_id']
    }
  },
  {
    name: 'reload_tab',
    description: 'Reload a tab',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'ID of the tab to reload' } }
    }
  },
  {
    name: 'go_back',
    description: 'Navigate back in browser history',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'ID of the tab' } }
    }
  },
  {
    name: 'go_forward',
    description: 'Navigate forward in browser history',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'ID of the tab' } }
    }
  },
  {
    name: 'execute_javascript',
    description: 'Execute JavaScript in the current tab',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        tab_id: { type: 'number', description: 'ID of the tab' }
      },
      required: ['code']
    }
  },
  {
    name: 'get_page_content',
    description: 'Get the text content of the current page',
    inputSchema: {
      type: 'object',
      properties: { tab_id: { type: 'number', description: 'ID of the tab' } }
    }
  }
];


// Durable Object for managing WebSocket connection to local agent
export class ChromeAgent {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.agentSocket = null;
    this.pendingRequests = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    // WebSocket upgrade for local agent
    if (url.pathname === '/agent' && request.headers.get('Upgrade') === 'websocket') {
      return this.handleAgentConnection(request);
    }
    
    // Execute command (called from main worker)
    if (url.pathname === '/execute' && request.method === 'POST') {
      return this.executeCommand(request);
    }
    
    // Status check
    if (url.pathname === '/status') {
      return new Response(JSON.stringify({
        connected: this.agentSocket !== null,
        pendingRequests: this.pendingRequests.size
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    
    return new Response('Not found', { status: 404 });
  }


  handleAgentConnection(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    this.agentSocket = server;
    server.accept();
    
    server.addEventListener('message', (event) => {
      try {
        const response = JSON.parse(event.data);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          pending.resolve(response);
          this.pendingRequests.delete(response.id);
        }
      } catch (e) {
        console.error('Failed to parse agent message:', e);
      }
    });
    
    server.addEventListener('close', () => {
      this.agentSocket = null;
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error('Agent disconnected'));
        this.pendingRequests.delete(id);
      }
    });
    
    server.addEventListener('error', (e) => {
      console.error('Agent WebSocket error:', e);
    });
    
    return new Response(null, { status: 101, webSocket: client });
  }


  async executeCommand(request) {
    if (!this.agentSocket) {
      return new Response(JSON.stringify({
        error: 'Local agent not connected. Start the agent on your Mac.'
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    
    const { tool, args } = await request.json();
    const id = crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(new Response(JSON.stringify({
          error: 'Command timed out (30s)'
        }), { status: 504, headers: { 'Content-Type': 'application/json' } }));
      }, 30000);
      
      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' }
          }));
        },
        reject: (error) => {
          clearTimeout(timeout);
          resolve(new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
          }));
        }
      });
      
      this.agentSocket.send(JSON.stringify({ id, tool, args }));
    });
  }
}


// Main worker - handles MCP protocol
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Get the Durable Object
    const agentId = env.CHROME_AGENT.idFromName('default');
    const agent = env.CHROME_AGENT.get(agentId);
    
    // Agent WebSocket endpoint
    if (url.pathname === '/agent') {
      return agent.fetch(request);
    }
    
    // Status endpoint
    if (url.pathname === '/status') {
      return agent.fetch(request);
    }

    
    // MCP endpoint
    if (url.pathname === '/mcp' && request.method === 'POST') {
      const body = await request.json();
      const { method, params, id: reqId } = body;
      
      let result;
      
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'chrome-control-remote', version: '1.0.0' }
          };
          break;
          
        case 'tools/list':
          result = { tools: TOOLS };
          break;
          
        case 'tools/call':
          const { name, arguments: args } = params;
          const execResponse = await agent.fetch(new Request('http://internal/execute', {
            method: 'POST',
            body: JSON.stringify({ tool: name, args })
          }));
          const execResult = await execResponse.json();
          
          if (execResult.error) {
            result = {
              content: [{ type: 'text', text: `Error: ${execResult.error}` }],
              isError: true
            };
          } else {
            result = execResult.result;
          }
          break;
          
        default:
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'Method not found' },
            id: reqId
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        result,
        id: reqId
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    
    // SSE endpoint for MCP
    if (url.pathname === '/sse') {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      
      // Send initial connection message
      writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));
      
      return new Response(readable, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }
    
    // Home page with status
    if (url.pathname === '/') {
      const statusRes = await agent.fetch(new Request('http://internal/status'));
      const status = await statusRes.json();
      
      return new Response(`
        <html>
          <head><title>Chrome Control MCP</title></head>
          <body style="font-family: system-ui; padding: 2rem;">
            <h1>Chrome Control Remote MCP Server</h1>
            <p>Agent Connected: <strong>${status.connected ? '✅ Yes' : '❌ No'}</strong></p>
            <p>Pending Requests: ${status.pendingRequests}</p>
            <h2>Endpoints</h2>
            <ul>
              <li><code>/agent</code> - WebSocket for local agent</li>
              <li><code>/mcp</code> - MCP JSON-RPC endpoint</li>
              <li><code>/sse</code> - SSE endpoint</li>
              <li><code>/status</code> - Status JSON</li>
            </ul>
          </body>
        </html>
      `, { headers: { ...corsHeaders, 'Content-Type': 'text/html' } });
    }
    
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};
