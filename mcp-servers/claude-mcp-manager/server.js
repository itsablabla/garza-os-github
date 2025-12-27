import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || 'claude-mcp-mgr-2025';
const PORT = process.env.PORT || 8080;

let browser = null;
let context = null;
let page = null;

const auth = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

async function initBrowser() {
  if (browser) return;
  console.log('Launching browser...');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const cookies = JSON.parse(process.env.CLAUDE_COOKIES || '[]');
    if (cookies.length) await context.addCookies(cookies);
  } catch (e) {}
  page = await context.newPage();
  console.log('Browser ready');
}

async function screenshot() {
  const buffer = await page.screenshot({ fullPage: true });
  return buffer.toString('base64');
}

app.get('/health', (req, res) => res.json({ status: 'ok', browser: !!browser }));

app.get('/status', auth, async (req, res) => {
  try {
    await initBrowser();
    await page.goto('https://claude.ai', { waitUntil: 'networkidle', timeout: 30000 });
    res.json({ loggedIn: !page.url().includes('/login'), url: page.url() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/screenshot', auth, async (req, res) => {
  try {
    await initBrowser();
    res.json({ image: await screenshot(), url: page.url() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/goto', auth, async (req, res) => {
  try {
    await initBrowser();
    await page.goto(req.body.url, { waitUntil: 'networkidle', timeout: 30000 });
    res.json({ url: page.url() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/cookies', auth, async (req, res) => {
  try {
    await initBrowser();
    await context.addCookies(req.body.cookies);
    res.json({ success: true, count: req.body.cookies.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/cookies', auth, async (req, res) => {
  try {
    await initBrowser();
    res.json({ cookies: await context.cookies() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/integrations', auth, async (req, res) => {
  try {
    await initBrowser();
    await page.goto('https://claude.ai/settings/integrations', { waitUntil: 'networkidle', timeout: 30000 });
    res.json({ url: page.url(), screenshot: await screenshot() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/click', auth, async (req, res) => {
  try {
    await initBrowser();
    await page.click(req.body.selector, { timeout: 5000 });
    await page.waitForTimeout(1000);
    res.json({ success: true, screenshot: await screenshot() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/fill', auth, async (req, res) => {
  try {
    await initBrowser();
    await page.fill(req.body.selector, req.body.value);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/html', auth, async (req, res) => {
  try {
    await initBrowser();
    res.json({ html: (await page.content()).substring(0, 50000), url: page.url() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sse', (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send('Unauthorized');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const tools = [
    { name: 'mcpmgr:status', description: 'Check claude.ai login', inputSchema: { type: 'object', properties: {} } },
    { name: 'mcpmgr:screenshot', description: 'Screenshot page', inputSchema: { type: 'object', properties: {} } },
    { name: 'mcpmgr:goto', description: 'Navigate', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'mcpmgr:integrations', description: 'Go to integrations', inputSchema: { type: 'object', properties: {} } },
    { name: 'mcpmgr:click', description: 'Click', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
    { name: 'mcpmgr:fill', description: 'Fill', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' } }, required: ['selector', 'value'] } },
    { name: 'mcpmgr:html', description: 'Get HTML', inputSchema: { type: 'object', properties: {} } },
    { name: 'mcpmgr:set_cookies', description: 'Set cookies', inputSchema: { type: 'object', properties: { cookies: { type: 'array' } }, required: ['cookies'] } }
  ];
  res.write(`data: ${JSON.stringify({ type: 'tools', tools })}\n\n`);
  const ka = setInterval(() => res.write(': keepalive\n\n'), 30000);
  req.on('close', () => clearInterval(ka));
});

initBrowser().then(() => app.listen(PORT, () => console.log(`Running on :${PORT}`))).catch(e => { console.error(e); process.exit(1); });
