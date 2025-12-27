import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || 'mcp-controller-2025-garza';
const PORT = process.env.PORT || 8080;

let browser = null;
let context = null;
let page = null;

// Auth middleware
const auth = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Initialize browser with persistent session
async function initBrowser() {
  if (browser) return;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1280, height: 800 },
    storageState: process.env.SESSION_FILE || undefined
  });
  page = await context.newPage();
  console.log('Browser initialized');
}

// Save session for persistence
async function saveSession() {
  if (context) {
    await context.storageState({ path: '/data/session.json' });
    console.log('Session saved');
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', browser: !!browser, page: !!page });
});

// Screenshot current state (for debugging)
app.get('/screenshot', auth, async (req, res) => {
  try {
    await initBrowser();
    const buffer = await page.screenshot({ fullPage: true });
    res.type('image/png').send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get current URL
app.get('/url', auth, async (req, res) => {
  try {
    await initBrowser();
    res.json({ url: page.url() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Navigate to URL
app.post('/navigate', auth, async (req, res) => {
  try {
    await initBrowser();
    const { url } = req.body;
    await page.goto(url, { waitUntil: 'networkidle' });
    await saveSession();
    res.json({ success: true, url: page.url() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Execute arbitrary action (for flexibility)
app.post('/action', auth, async (req, res) => {
  try {
    await initBrowser();
    const { action, selector, text, url } = req.body;
    
    switch (action) {
      case 'click':
        await page.click(selector);
        break;
      case 'fill':
        await page.fill(selector, text);
        break;
      case 'type':
        await page.type(selector, text);
        break;
      case 'goto':
        await page.goto(url, { waitUntil: 'networkidle' });
        break;
      case 'wait':
        await page.waitForSelector(selector, { timeout: 10000 });
        break;
      case 'press':
        await page.keyboard.press(text);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    await saveSession();
    res.json({ success: true, url: page.url() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get page content/text
app.get('/content', auth, async (req, res) => {
  try {
    await initBrowser();
    const content = await page.content();
    res.json({ url: page.url(), html: content.substring(0, 50000) }); // Limit size
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get visible text
app.get('/text', auth, async (req, res) => {
  try {
    await initBrowser();
    const text = await page.innerText('body');
    res.json({ url: page.url(), text: text.substring(0, 20000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === CLAUDE.AI SPECIFIC ENDPOINTS ===

// Go to Claude settings
app.post('/claude/settings', auth, async (req, res) => {
  try {
    await initBrowser();
    await page.goto('https://claude.ai/settings', { waitUntil: 'networkidle' });
    await saveSession();
    const text = await page.innerText('body');
    res.json({ success: true, url: page.url(), text: text.substring(0, 5000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List current MCPs
app.get('/claude/mcps', auth, async (req, res) => {
  try {
    await initBrowser();
    // Navigate to integrations/connections page
    await page.goto('https://claude.ai/settings/integrations', { waitUntil: 'networkidle' });
    await saveSession();
    
    // Get page text to parse MCPs
    const text = await page.innerText('body');
    res.json({ success: true, url: page.url(), content: text.substring(0, 10000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add MCP - we'll refine selectors after seeing the UI
app.post('/claude/mcps', auth, async (req, res) => {
  try {
    await initBrowser();
    const { name, url: mcpUrl } = req.body;
    
    // Navigate to integrations
    await page.goto('https://claude.ai/settings/integrations', { waitUntil: 'networkidle' });
    
    // TODO: Click "Add" button, fill form, submit
    // Will need to map actual selectors
    
    await saveSession();
    res.json({ success: true, message: 'TODO: implement after UI mapping', name, url: mcpUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`MCP Controller running on :${PORT}`));
