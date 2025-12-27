import express from 'express';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

// Store active browser sessions
const sessions = new Map();

// Get or create browser session
async function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    sessions.set(sessionId, { browser, page, lastUsed: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastUsed = Date.now();
  return session;
}

// MCP Tools definition
const TOOLS = [
  {
    name: 'computer_screenshot',
    description: 'Take a screenshot of the current browser state. Returns base64 image.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID for browser persistence (optional, auto-generated if not provided)' }
      }
    }
  },
  {
    name: 'computer_navigate',
    description: 'Navigate browser to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        session_id: { type: 'string', description: 'Session ID for browser persistence' }
      },
      required: ['url']
    }
  },
  {
    name: 'computer_click',
    description: 'Click at specific x,y coordinates on the page',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        session_id: { type: 'string', description: 'Session ID for browser persistence' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_type',
    description: 'Type text at current cursor position',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        session_id: { type: 'string', description: 'Session ID for browser persistence' }
      },
      required: ['text']
    }
  },
  {
    name: 'computer_scroll',
    description: 'Scroll the page',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default 300)' },
        session_id: { type: 'string', description: 'Session ID for browser persistence' }
      },
      required: ['direction']
    }
  },
  {
    name: 'computer_key',
    description: 'Press a keyboard key (Enter, Tab, Escape, etc)',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (Enter, Tab, Escape, Backspace, etc)' },
        session_id: { type: 'string', description: 'Session ID for browser persistence' }
      },
      required: ['key']
    }
  },
  {
    name: 'computer_close',
    description: 'Close a browser session',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to close' }
      },
      required: ['session_id']
    }
  }
];

// Tool execution
async function executeTool(name, args) {
  const sessionId = args.session_id || uuidv4();
  
  try {
    switch (name) {
      case 'computer_screenshot': {
        const { page } = await getSession(sessionId);
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        const url = page.url();
        return { 
          session_id: sessionId, 
          url,
          screenshot: `data:image/png;base64,${screenshot}`,
          width: 1280,
          height: 800
        };
      }
      
      case 'computer_navigate': {
        const { page } = await getSession(sessionId);
        await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 30000 });
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        return { 
          session_id: sessionId, 
          url: page.url(),
          title: await page.title(),
          screenshot: `data:image/png;base64,${screenshot}`
        };
      }
      
      case 'computer_click': {
        const { page } = await getSession(sessionId);
        await page.mouse.click(args.x, args.y);
        await page.waitForTimeout(500); // Wait for any animations/navigation
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        return { 
          session_id: sessionId, 
          clicked: { x: args.x, y: args.y },
          url: page.url(),
          screenshot: `data:image/png;base64,${screenshot}`
        };
      }
      
      case 'computer_type': {
        const { page } = await getSession(sessionId);
        await page.keyboard.type(args.text, { delay: 50 });
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        return { 
          session_id: sessionId, 
          typed: args.text,
          screenshot: `data:image/png;base64,${screenshot}`
        };
      }
      
      case 'computer_scroll': {
        const { page } = await getSession(sessionId);
        const amount = args.amount || 300;
        const delta = args.direction === 'up' ? -amount : amount;
        await page.mouse.wheel({ deltaY: delta });
        await page.waitForTimeout(300);
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        return { 
          session_id: sessionId, 
          scrolled: { direction: args.direction, amount },
          screenshot: `data:image/png;base64,${screenshot}`
        };
      }
      
      case 'computer_key': {
        const { page } = await getSession(sessionId);
        await page.keyboard.press(args.key);
        await page.waitForTimeout(300);
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        return { 
          session_id: sessionId, 
          pressed: args.key,
          screenshot: `data:image/png;base64,${screenshot}`
        };
      }
      
      case 'computer_close': {
        const session = sessions.get(sessionId);
        if (session) {
          await session.browser.close();
          sessions.delete(sessionId);
          return { closed: sessionId };
        }
        return { error: 'Session not found' };
      }
      
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message, session_id: sessionId };
  }
}

// SSE endpoint for MCP
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const sessionId = uuidv4();
  
  // Send endpoint info
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
  
  // Keep alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);
  
  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// Messages endpoint for MCP
app.post('/messages', async (req, res) => {
  const { method, params, id } = req.body;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  try {
    switch (method) {
      case 'initialize':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'computer-use-mcp', version: '1.0.0' },
            capabilities: { tools: {} }
          }
        });
        
      case 'tools/list':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS }
        });
        
      case 'tools/call':
        const result = await executeTool(params.name, params.arguments || {});
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }] }
        });
        
      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {}
        });
    }
  } catch (err) {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err.message }
    });
  }
});

// CORS preflight
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// Cleanup old sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > 10 * 60 * 1000) { // 10 min idle
      session.browser.close();
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 8931;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Computer Use MCP running on port ${PORT}`);
});
