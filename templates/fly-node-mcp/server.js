/**
 * GARZA OS - Base MCP Server Template
 * Copy this and customize for new MCP servers
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });
await app.register(cors, { origin: '*' });

const API_KEY = process.env.API_KEY || 'change-me-in-production';
const PORT = process.env.PORT || 8080;

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================
function checkAuth(request, reply, done) {
  const key = request.query.key || request.headers['x-api-key'];
  if (key !== API_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  done();
}

// =============================================================================
// HEALTH & INFO
// =============================================================================
app.get('/health', async () => ({
  status: 'ok',
  server: 'your-mcp-name',
  timestamp: new Date().toISOString()
}));

// =============================================================================
// MCP SSE ENDPOINT
// =============================================================================
const sessions = new Map();

app.get('/sse', { preHandler: checkAuth }, async (request, reply) => {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { created: Date.now() });
  
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send endpoint info
  reply.raw.write(`data: /messages?sessionId=${sessionId}&key=${request.query.key}\n\n`);
  
  // Keep alive
  const keepAlive = setInterval(() => {
    reply.raw.write(': keepalive\n\n');
  }, 30000);
  
  request.raw.on('close', () => {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

// =============================================================================
// MCP MESSAGES ENDPOINT
// =============================================================================
app.post('/messages', { preHandler: checkAuth }, async (request, reply) => {
  const { method, params, id } = request.body;
  
  try {
    let result;
    
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'your-mcp-name', version: '1.0.0' },
          capabilities: { tools: {} }
        };
        break;
        
      case 'tools/list':
        result = { tools: getToolDefinitions() };
        break;
        
      case 'tools/call':
        result = await handleToolCall(params.name, params.arguments);
        break;
        
      default:
        result = {};
    }
    
    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: -1, message: error.message } };
  }
});

// =============================================================================
// TOOL DEFINITIONS - CUSTOMIZE THESE
// =============================================================================
function getToolDefinitions() {
  return [
    {
      name: 'ping',
      description: 'Health check',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    // ADD YOUR TOOLS HERE
  ];
}

// =============================================================================
// TOOL HANDLERS - CUSTOMIZE THESE
// =============================================================================
async function handleToolCall(name, args) {
  switch (name) {
    case 'ping':
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'pong', timestamp: new Date().toISOString() }) }] };
    
    // ADD YOUR HANDLERS HERE
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// =============================================================================
// START SERVER
// =============================================================================
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) throw err;
  console.log(`MCP server running at ${address}`);
});
