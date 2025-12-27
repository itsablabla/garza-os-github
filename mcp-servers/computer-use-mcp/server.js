import express from 'express';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

// Store active browser sessions
const sessions = new Map();

// SSE connections
const sseClients = new Map();

// Default session - persistent browser
let defaultBrowser = null;
let defaultPage = null;

async function getDefaultPage() {
  if (!defaultBrowser || !defaultBrowser.isConnected()) {
    defaultBrowser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
    defaultPage = await defaultBrowser.newPage();
    await defaultPage.setViewport({ width: 1920, height: 1080 });
  }
  if (!defaultPage || defaultPage.isClosed()) {
    defaultPage = await defaultBrowser.newPage();
    await defaultPage.setViewport({ width: 1920, height: 1080 });
  }
  return defaultPage;
}

// MCP Tools
const tools = [
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current browser view. Returns base64 PNG image.',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', description: 'Capture full scrollable page', default: false }
      }
    }
  },
  {
    name: 'navigate',
    description: 'Navigate browser to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' }
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
        y: { type: 'number', description: 'Y coordinate' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'type',
    description: 'Type text at current cursor position',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        delay: { type: 'number', description: 'Delay between keystrokes in ms', default: 50 }
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
        x: { type: 'number', description: 'Horizontal scroll pixels', default: 0 },
        y: { type: 'number', description: 'Vertical scroll pixels', default: 300 }
      }
    }
  },
  {
    name: 'key',
    description: 'Press a keyboard key (Enter, Tab, Escape, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (Enter, Tab, Escape, Backspace, etc.)' }
      },
      required: ['key']
    }
  },
  {
    name: 'get_url',
    description: 'Get the current page URL',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait', default: 1000 }
      }
    }
  }
];

// Execute tool
async function executeTool(name, args) {
  const page = await getDefaultPage();
  
  switch (name) {
    case 'screenshot': {
      const screenshot = await page.screenshot({
        encoding: 'base64',
        fullPage: args.fullPage || false
      });
      return {
        type: 'image',
        data: screenshot,
        mimeType: 'image/png'
      };
    }
    
    case 'navigate': {
      await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 30000 });
      return { success: true, url: page.url(), title: await page.title() };
    }
    
    case 'click': {
      await page.mouse.click(args.x, args.y);
      await page.waitForTimeout(500); // Brief wait for any reactions
      return { success: true, clicked: { x: args.x, y: args.y } };
    }
    
    case 'type': {
      await page.keyboard.type(args.text, { delay: args.delay || 50 });
      return { success: true, typed: args.text.length + ' characters' };
    }
    
    case 'scroll': {
      await page.evaluate((x, y) => window.scrollBy(x, y), args.x || 0, args.y || 300);
      return { success: true, scrolled: { x: args.x || 0, y: args.y || 300 } };
    }
    
    case 'key': {
      await page.keyboard.press(args.key);
      return { success: true, pressed: args.key };
    }
    
    case 'get_url': {
      return { url: page.url(), title: await page.title() };
    }
    
    case 'wait': {
      await page.waitForTimeout(args.ms || 1000);
      return { success: true, waited: args.ms || 1000 };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// SSE endpoint
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const clientId = uuidv4();
  sseClients.set(clientId, res);
  
  // Send endpoint info
  res.write(`data: ${JSON.stringify({ type: 'endpoint', url: `/message?clientId=${clientId}` })}\n\n`);
  
  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

// Message endpoint for MCP protocol
app.post('/message', async (req, res) => {
  const { method, params, id } = req.body;
  
  try {
    let result;
    
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'computer-use-mcp', version: '1.0.0' }
        };
        break;
        
      case 'tools/list':
        result = { tools };
        break;
        
      case 'tools/call':
        const toolResult = await executeTool(params.name, params.arguments || {});
        result = {
          content: [
            toolResult.type === 'image' 
              ? { type: 'image', data: toolResult.data, mimeType: toolResult.mimeType }
              : { type: 'text', text: JSON.stringify(toolResult, null, 2) }
          ]
        };
        break;
        
      case 'notifications/initialized':
        result = {};
        break;
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', browser: !!defaultBrowser });
});

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 8931;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Computer Use MCP server running on port ${PORT}`);
  // Pre-launch browser
  getDefaultPage().then(() => console.log('Browser ready'));
});
