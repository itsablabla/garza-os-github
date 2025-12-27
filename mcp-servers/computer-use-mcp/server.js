import express from 'express';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

// Browser and page management
let browser = null;
let pages = new Map(); // sessionId -> page

const VIEWPORT = { width: 1280, height: 800 };

// Initialize browser
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });
  }
  return browser;
}

// Get or create page for session
async function getPage(sessionId) {
  if (!pages.has(sessionId)) {
    const b = await getBrowser();
    const page = await b.newPage();
    await page.setViewport(VIEWPORT);
    pages.set(sessionId, page);
  }
  return pages.get(sessionId);
}

// Tool definitions
const TOOLS = [
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current page. Returns base64 PNG image.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID (optional, creates new if not provided)' }
      }
    }
  },
  {
    name: 'navigate',
    description: 'Navigate to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        sessionId: { type: 'string', description: 'Session ID (optional)' }
      },
      required: ['url']
    }
  },
  {
    name: 'click',
    description: 'Click at specific x,y coordinates on the page',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        sessionId: { type: 'string', description: 'Session ID (optional)' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'type',
    description: 'Type text. If x,y provided, clicks there first.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        x: { type: 'number', description: 'X coordinate to click before typing (optional)' },
        y: { type: 'number', description: 'Y coordinate to click before typing (optional)' },
        pressEnter: { type: 'boolean', description: 'Press Enter after typing' },
        sessionId: { type: 'string', description: 'Session ID (optional)' }
      },
      required: ['text']
    }
  },
  {
    name: 'scroll',
    description: 'Scroll the page',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default 300)' },
        sessionId: { type: 'string', description: 'Session ID (optional)' }
      },
      required: ['direction']
    }
  },
  {
    name: 'wait',
    description: 'Wait for specified milliseconds or for page to load',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (default 1000)' },
        sessionId: { type: 'string', description: 'Session ID (optional)' }
      }
    }
  },
  {
    name: 'key',
    description: 'Press a keyboard key (Enter, Tab, Escape, etc)',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (Enter, Tab, Escape, Backspace, etc)' },
        sessionId: { type: 'string', description: 'Session ID (optional)' }
      },
      required: ['key']
    }
  },
  {
    name: 'close_session',
    description: 'Close a browser session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to close' }
      },
      required: ['sessionId']
    }
  }
];

// Execute tool
async function executeTool(name, args) {
  const sessionId = args.sessionId || uuidv4();
  
  try {
    switch (name) {
      case 'screenshot': {
        const page = await getPage(sessionId);
        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        const url = page.url();
        return {
          sessionId,
          url,
          viewport: VIEWPORT,
          image: {
            type: 'image',
            data: screenshot,
            mimeType: 'image/png'
          }
        };
      }
      
      case 'navigate': {
        const page = await getPage(sessionId);
        await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 30000 });
        const title = await page.title();
        return { sessionId, url: args.url, title, status: 'navigated' };
      }
      
      case 'click': {
        const page = await getPage(sessionId);
        await page.mouse.click(args.x, args.y);
        await page.waitForTimeout(500); // Brief wait for any reactions
        return { sessionId, clicked: { x: args.x, y: args.y }, status: 'clicked' };
      }
      
      case 'type': {
        const page = await getPage(sessionId);
        if (args.x !== undefined && args.y !== undefined) {
          await page.mouse.click(args.x, args.y);
          await page.waitForTimeout(200);
        }
        await page.keyboard.type(args.text, { delay: 50 });
        if (args.pressEnter) {
          await page.keyboard.press('Enter');
        }
        return { sessionId, typed: args.text, status: 'typed' };
      }
      
      case 'scroll': {
        const page = await getPage(sessionId);
        const amount = args.amount || 300;
        const scrollMap = {
          up: [0, -amount],
          down: [0, amount],
          left: [-amount, 0],
          right: [amount, 0]
        };
        const [x, y] = scrollMap[args.direction];
        await page.mouse.wheel({ deltaX: x, deltaY: y });
        return { sessionId, scrolled: args.direction, amount, status: 'scrolled' };
      }
      
      case 'wait': {
        const page = await getPage(sessionId);
        const ms = args.ms || 1000;
        await page.waitForTimeout(ms);
        return { sessionId, waited: ms, status: 'waited' };
      }
      
      case 'key': {
        const page = await getPage(sessionId);
        await page.keyboard.press(args.key);
        return { sessionId, pressed: args.key, status: 'key_pressed' };
      }
      
      case 'close_session': {
        if (pages.has(args.sessionId)) {
          const page = pages.get(args.sessionId);
          await page.close();
          pages.delete(args.sessionId);
          return { sessionId: args.sessionId, status: 'closed' };
        }
        return { sessionId: args.sessionId, status: 'not_found' };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return { sessionId, error: error.message, status: 'error' };
  }
}

// SSE endpoint
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const clientId = uuidv4();
  console.log(`Client connected: ${clientId}`);

  // Send endpoint info
  res.write(`event: endpoint\ndata: /messages?clientId=${clientId}\n\n`);

  // Keep alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    console.log(`Client disconnected: ${clientId}`);
  });
});

// Messages endpoint (JSON-RPC over HTTP)
app.post('/messages', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { method, params, id } = req.body;
  console.log(`Request: ${method}`, params);

  try {
    switch (method) {
      case 'initialize':
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'computer-use-mcp', version: '1.0.0' }
          }
        });
        break;

      case 'notifications/initialized':
        res.json({ jsonrpc: '2.0', id, result: {} });
        break;

      case 'tools/list':
        res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS }
        });
        break;

      case 'tools/call':
        const { name, arguments: args } = params;
        const result = await executeTool(name, args || {});
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          }
        });
        break;

      default:
        res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }
  } catch (error) {
    console.error('Error:', error);
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error.message }
    });
  }
});

// CORS preflight
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: pages.size });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Computer Use MCP server running on port ${PORT}`);
});
