const express = require('express');
const puppeteer = require('puppeteer');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic();
let browser, page;

// ========== BROWSER INIT ==========
async function initBrowser() {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--window-size=1280,800']
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  console.log('🌐 Browser ready');
}

// ========== NEW: SCREENSHOT DIFFING ==========
let lastScreenshotHash = null;
let lastScreenshotData = null;

function hashScreenshot(base64Data) {
  return crypto.createHash('md5').update(base64Data).digest('hex');
}

async function getScreenshotWithDiff(fullPage = false) {
  const screenshot = await page.screenshot({ encoding: 'base64', fullPage });
  const currentHash = hashScreenshot(screenshot);
  
  const diff = {
    hash: currentHash,
    changed: lastScreenshotHash !== currentHash,
    previousHash: lastScreenshotHash
  };
  
  lastScreenshotHash = currentHash;
  lastScreenshotData = screenshot;
  
  return { screenshot, diff };
}

async function getScreenshot(fullPage = false) {
  return await page.screenshot({ encoding: 'base64', fullPage });
}

// ========== NEW: ELEMENT CACHE ==========
let elementCache = {
  url: null,
  timestamp: 0,
  elements: [],
  ttl: 3000 // 3 second cache
};

// ========== NEW: FORM INTELLIGENCE ==========
async function detectForms() {
  return await page.evaluate(() => {
    const forms = [];
    document.querySelectorAll('form').forEach((form, idx) => {
      const fields = [];
      form.querySelectorAll('input, select, textarea').forEach(el => {
        const field = {
          type: el.tagName.toLowerCase() === 'select' ? 'select' : (el.type || 'text'),
          name: el.name || el.id || '',
          placeholder: el.placeholder || '',
          label: '',
          required: el.required,
          value: el.value || '',
          options: []
        };
        
        // Find associated label
        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label) field.label = label.textContent.trim();
        }
        
        // For selects, get options
        if (el.tagName.toLowerCase() === 'select') {
          field.options = Array.from(el.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
        }
        
        // Infer field purpose from various hints
        const hints = [field.name, field.placeholder, field.label, el.id].join(' ').toLowerCase();
        if (hints.includes('email')) field.purpose = 'email';
        else if (hints.includes('password')) field.purpose = 'password';
        else if (hints.includes('phone') || hints.includes('tel')) field.purpose = 'phone';
        else if (hints.includes('name') && !hints.includes('user')) field.purpose = 'name';
        else if (hints.includes('user')) field.purpose = 'username';
        else if (hints.includes('search')) field.purpose = 'search';
        else if (hints.includes('date')) field.purpose = 'date';
        else if (hints.includes('address')) field.purpose = 'address';
        else if (hints.includes('zip') || hints.includes('postal')) field.purpose = 'zipcode';
        else if (hints.includes('city')) field.purpose = 'city';
        else if (hints.includes('state')) field.purpose = 'state';
        else if (hints.includes('country')) field.purpose = 'country';
        
        fields.push(field);
      });
      
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      forms.push({
        index: idx,
        action: form.action,
        method: form.method || 'get',
        fields,
        submitButton: submitBtn ? submitBtn.textContent || submitBtn.value || 'Submit' : null
      });
    });
    return forms;
  });
}

// ========== ENHANCED ELEMENT DETECTION ==========
async function getElements(useCache = true) {
  const currentUrl = page.url();
  const now = Date.now();
  
  // Check cache
  if (useCache && elementCache.url === currentUrl && (now - elementCache.timestamp) < elementCache.ttl) {
    return elementCache.elements;
  }
  
  const elements = await page.evaluate(() => {
    const viewportHeight = window.innerHeight;
    const scrollTop = window.scrollY;
    const els = [];
    
    document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick], [tabindex="0"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      
      const computedStyle = window.getComputedStyle(el);
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') return;
      
      let text = el.textContent?.trim() || el.value || el.placeholder || el.title || el.alt || el.getAttribute('aria-label') || '';
      text = text.replace(/\s+/g, ' ').slice(0, 80);
      
      els.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        text,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.top >= 0 && rect.top < viewportHeight,
        belowFold: rect.top >= viewportHeight,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        href: el.href || null,
        expanded: el.getAttribute('aria-expanded'),
        selected: el.getAttribute('aria-selected'),
        checked: el.checked || false
      });
    });
    
    return els.sort((a, b) => {
      if (a.visible && !b.visible) return -1;
      if (!a.visible && b.visible) return 1;
      return a.y - b.y;
    });
  });
  
  // Update cache
  elementCache = { url: currentUrl, timestamp: now, elements, ttl: 3000 };
  
  return elements;
}

async function findElement(target) {
  const elements = await getElements(false); // Don't use cache for clicks
  target = target.toLowerCase();
  
  // Priority matching: exact > starts with > contains > partial
  let match = elements.find(e => e.text.toLowerCase() === target);
  if (!match) match = elements.find(e => e.text.toLowerCase().startsWith(target));
  if (!match) match = elements.find(e => e.text.toLowerCase().includes(target));
  if (!match) match = elements.find(e => target.split(' ').every(w => e.text.toLowerCase().includes(w)));
  
  return match;
}

// ========== PAGE STATE DETECTION ==========
async function getPageState() {
  return {
    url: page.url(),
    title: await page.title(),
    scrollY: await page.evaluate(() => window.scrollY),
    contentHash: await page.evaluate(() => {
      const main = document.querySelector('main, article, #content, .content, body');
      return main ? main.textContent.slice(0, 1000).replace(/\s+/g, '').length : 0;
    })
  };
}

function pageChanged(before, after) {
  if (before.url !== after.url) return { changed: true, reason: 'url_changed' };
  if (before.title !== after.title) return { changed: true, reason: 'title_changed' };
  if (Math.abs(before.scrollY - after.scrollY) > 50) return { changed: true, reason: 'scroll_position' };
  if (before.contentHash !== after.contentHash) return { changed: true, reason: 'content_changed' };
  return { changed: false, reason: 'no_change' };
}

// ========== AGENT TOOLS (Claude's toolbox) ==========
const AGENT_TOOLS = [
  { name: 'click', description: 'Click element by text', input_schema: { type: 'object', properties: { target: { type: 'string', description: 'Text of element to click' }}, required: ['target'] }},
  { name: 'type', description: 'Type into field', input_schema: { type: 'object', properties: { text: { type: 'string' }, into: { type: 'string', description: 'Field identifier (optional)' }}, required: ['text'] }},
  { name: 'scroll', description: 'Scroll page', input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }}, required: ['direction'] }},
  { name: 'navigate', description: 'Go to URL', input_schema: { type: 'object', properties: { url: { type: 'string' }}, required: ['url'] }},
  { name: 'wait', description: 'Wait for page to load', input_schema: { type: 'object', properties: { ms: { type: 'number', default: 2000 }}}},
  { name: 'fill_form', description: 'Fill form field by purpose', input_schema: { type: 'object', properties: { purpose: { type: 'string', description: 'Field purpose: email, password, name, phone, search, etc.' }, value: { type: 'string' }}, required: ['purpose', 'value'] }},
  { name: 'done', description: 'Goal achieved', input_schema: { type: 'object', properties: { result: { type: 'string', description: 'The information or confirmation of success' }}, required: ['result'] }},
  { name: 'stuck', description: 'Cannot proceed', input_schema: { type: 'object', properties: { reason: { type: 'string' }}, required: ['reason'] }}
];

// ========== AGENT SYSTEM PROMPT ==========
const AGENT_SYSTEM = `You are a browser automation agent. You see screenshots and execute actions to achieve goals.

CORE PRINCIPLES:
1. OBSERVE: Look at the screenshot carefully. What page are you on? What elements are visible?
2. THINK: What's the shortest path to the goal from here?
3. ACT: Choose ONE action that makes progress toward the goal
4. VERIFY: After each action, check if the goal is achieved - if so, call done() immediately

CRITICAL RULES:
- NEVER repeat the same action twice in a row
- If an action had no effect, try a DIFFERENT approach
- If you see the goal information on screen, call done() immediately with the answer
- If login/auth blocks you and you have no credentials, call stuck()
- Prefer clicking visible buttons over scrolling
- Look at element states (disabled, expanded) before clicking
- Use fill_form when you can identify a field's purpose (email, password, etc.)

COMMON PATTERNS:
- Cookie banners: Click "Accept" or "Agree" first
- Dropdowns: Click to expand, then click option
- Modal dialogs: Look for close button (X) or primary action
- Forms: Use fill_form for known field types, then submit

SCREENSHOT DIFF INFO:
- If diff.changed is false, your last action had no visible effect
- Try something different when you see repeated no-change

You have access to tools. Use exactly ONE tool per turn.`;

// ========== EXECUTE ACTION ==========
async function executeToolAction(toolName, toolInput) {
  switch (toolName) {
    case 'click': {
      const el = await findElement(toolInput.target);
      if (!el) return { success: false, error: `Element not found: "${toolInput.target}"` };
      await page.mouse.click(el.x, el.y);
      await new Promise(r => setTimeout(r, 1500));
      elementCache.timestamp = 0; // Invalidate cache after click
      return { success: true, action: 'click', target: toolInput.target, clicked: el.text };
    }
    case 'type': {
      if (toolInput.into) {
        const el = await findElement(toolInput.into);
        if (el) await page.mouse.click(el.x, el.y);
      }
      await new Promise(r => setTimeout(r, 200));
      await page.keyboard.type(toolInput.text, { delay: 50 });
      return { success: true, action: 'type', text: toolInput.text, into: toolInput.into };
    }
    case 'fill_form': {
      // NEW: Intelligent form filling
      const forms = await detectForms();
      for (const form of forms) {
        const field = form.fields.find(f => f.purpose === toolInput.purpose);
        if (field) {
          // Find and click the field
          const selector = field.name ? `[name="${field.name}"]` : `[placeholder*="${field.placeholder}"]`;
          try {
            await page.click(selector);
            await page.keyboard.type(toolInput.value, { delay: 30 });
            return { success: true, action: 'fill_form', purpose: toolInput.purpose, field: field.name };
          } catch (e) {
            // Fallback: find by label text
            const el = await findElement(field.label || field.placeholder);
            if (el) {
              await page.mouse.click(el.x, el.y);
              await page.keyboard.type(toolInput.value, { delay: 30 });
              return { success: true, action: 'fill_form', purpose: toolInput.purpose };
            }
          }
        }
      }
      return { success: false, error: `No ${toolInput.purpose} field found` };
    }
    case 'scroll': {
      const delta = toolInput.direction === 'up' ? -600 : 600;
      await page.evaluate(d => window.scrollBy(0, d), delta);
      await new Promise(r => setTimeout(r, 500));
      elementCache.timestamp = 0; // Invalidate cache after scroll
      return { success: true, action: 'scroll', direction: toolInput.direction };
    }
    case 'navigate': {
      await page.goto(toolInput.url, { waitUntil: 'networkidle2', timeout: 30000 });
      elementCache.timestamp = 0;
      return { success: true, action: 'navigate', url: toolInput.url };
    }
    case 'wait': {
      await new Promise(r => setTimeout(r, toolInput.ms || 2000));
      return { success: true, action: 'wait', ms: toolInput.ms || 2000 };
    }
    case 'done': {
      return { action: 'done', result: toolInput.result };
    }
    case 'stuck': {
      return { action: 'stuck', reason: toolInput.reason };
    }
    default:
      return { success: false, error: `Unknown action: ${toolName}` };
  }
}

// ========== MAIN AUTOMATION LOOP ==========
async function automate(goal, options = {}) {
  const { startUrl, credentials, maxSteps = 25 } = options;
  const log = [];
  const actionHistory = [];
  let consecutiveNoChange = 0;
  let lastAction = null;
  
  // Navigate to start URL if provided
  if (startUrl) {
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    log.push({ step: 0, action: 'navigate', url: startUrl });
    elementCache.timestamp = 0;
  }

  for (let step = 1; step <= maxSteps; step++) {
    try {
      // Capture state before action
      const stateBefore = await getPageState();
      
      // Get screenshot with diff info
      const { screenshot, diff } = await getScreenshotWithDiff();
      const elements = await getElements();
      const forms = await detectForms();
      
      // Format elements
      const elementsText = elements.slice(0, 30).map(e => {
        let info = `[${e.tag}] "${e.text}"`;
        if (e.disabled) info += ' (disabled)';
        if (e.expanded === 'true') info += ' (expanded)';
        if (e.expanded === 'false') info += ' (collapsed)';
        if (e.href) info += ` → ${e.href.slice(0, 40)}`;
        if (!e.visible) info += ' (below fold)';
        return info;
      }).join('\n');

      // Format forms if any
      const formsText = forms.length > 0 
        ? `\nDETECTED FORMS:\n${forms.map(f => 
            `  Form ${f.index}: ${f.fields.map(fd => fd.purpose || fd.type).join(', ')} [${f.submitButton || 'no submit'}]`
          ).join('\n')}`
        : '';

      // Build action history summary
      const historyText = actionHistory.length > 0 
        ? `PREVIOUS ACTIONS (${actionHistory.length} total):\n${actionHistory.slice(-8).map((a, i) => 
            `  ${actionHistory.length - 8 + i + 1}. ${a.summary}${a.hadEffect ? '' : ' ⚠️ NO EFFECT'}`
          ).join('\n')}`
        : 'PREVIOUS ACTIONS: None yet';

      // Warnings
      let warningText = '';
      if (consecutiveNoChange >= 2) {
        warningText = `\n\n⚠️ WARNING: Last ${consecutiveNoChange} actions had NO VISIBLE EFFECT. Try something different!`;
      }
      if (!diff.changed && step > 1) {
        warningText += `\n📸 SCREENSHOT UNCHANGED since last action.`;
      }

      // Ask Claude for next action
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: AGENT_SYSTEM,
        tools: AGENT_TOOLS,
        tool_choice: { type: 'any' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot }},
            { type: 'text', text: `GOAL: ${goal}
${credentials ? `CREDENTIALS: email=${credentials.email}` : 'NO CREDENTIALS'}
URL: ${stateBefore.url}
TITLE: ${stateBefore.title}
STEP: ${step}/${maxSteps}
SCREENSHOT_CHANGED: ${diff.changed}

${historyText}
${warningText}

VISIBLE ELEMENTS (${elements.length} total):
${elementsText}
${formsText}

Choose ONE action. If goal info is visible, call done() immediately.` }
          ]
        }]
      });

      // Extract tool use
      const toolUse = response.content.find(c => c.type === 'tool_use');
      if (!toolUse) {
        log.push({ step, error: 'No tool use in response' });
        continue;
      }

      const { name: toolName, input: toolInput } = toolUse;
      const actionSummary = `${toolName}(${JSON.stringify(toolInput)})`;
      log.push({ step, thought: actionSummary });
      
      // Execute
      const result = await executeToolAction(toolName, toolInput);
      log.push({ step, ...result });

      // Check page change
      const stateAfter = await getPageState();
      const changeResult = pageChanged(stateBefore, stateAfter);
      
      // Track history
      actionHistory.push({
        step,
        action: toolName,
        input: toolInput,
        summary: actionSummary,
        hadEffect: changeResult.changed,
        changeReason: changeResult.reason
      });

      // Track consecutive no-change
      if (!changeResult.changed && toolName !== 'done' && toolName !== 'stuck' && toolName !== 'wait') {
        consecutiveNoChange++;
      } else {
        consecutiveNoChange = 0;
      }
      lastAction = toolName;

      // Check completion
      if (result.action === 'done') {
        return { 
          success: true, 
          result: result.result, 
          steps: step, 
          log,
          finalUrl: page.url(),
          screenshot: await getScreenshot()
        };
      }
      if (result.action === 'stuck') {
        return { 
          success: false, 
          reason: result.reason, 
          steps: step, 
          log,
          finalUrl: page.url(),
          screenshot: await getScreenshot()
        };
      }
      
      // Auto-stuck
      if (consecutiveNoChange >= 4) {
        return {
          success: false,
          reason: `Auto-stuck: ${consecutiveNoChange} consecutive actions had no effect`,
          steps: step,
          log,
          finalUrl: page.url(),
          screenshot: await getScreenshot()
        };
      }

    } catch (err) {
      log.push({ step, error: err.message });
    }
  }

  return { 
    success: false, 
    reason: 'Max steps reached', 
    steps: maxSteps, 
    log,
    finalUrl: page.url(),
    screenshot: await getScreenshot()
  };
}

// ========== MCP TOOLS ==========
const tools = [
  { name: 'screenshot', description: 'Take screenshot', inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean', default: false } } } },
  { name: 'navigate', description: 'Navigate to URL', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'get_elements', description: 'Get clickable elements', inputSchema: { type: 'object', properties: {} } },
  { name: 'detect_forms', description: 'Detect and analyze forms on page', inputSchema: { type: 'object', properties: {} } },
  { name: 'click_element', description: 'Click by text or coords', inputSchema: { type: 'object', properties: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'type_text', description: 'Type text', inputSchema: { type: 'object', properties: { text: { type: 'string' }, into: { type: 'string' }, pressEnter: { type: 'boolean' } }, required: ['text'] } },
  { name: 'scroll', description: 'Scroll page', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number', default: 500 } }, required: ['direction'] } },
  { name: 'wait', description: 'Wait ms or selector', inputSchema: { type: 'object', properties: { ms: { type: 'number' }, selector: { type: 'string' } } } },
  { name: 'automate', description: 'Run autonomous agent v4.0', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, startUrl: { type: 'string' }, credentials: { type: 'object' }, maxSteps: { type: 'number', default: 25 } }, required: ['goal'] } }
];

async function handleTool(name, args) {
  switch (name) {
    case 'screenshot': {
      const img = await getScreenshot(args.fullPage);
      return { type: 'image', data: img, mimeType: 'image/png' };
    }
    case 'navigate': {
      await page.goto(args.url, { waitUntil: 'networkidle2', timeout: 30000 });
      const img = await getScreenshot();
      return { type: 'combo', url: page.url(), title: await page.title(), screenshot: img };
    }
    case 'get_elements': {
      const elements = await getElements(false);
      return { 
        elements,
        summary: `Found ${elements.length} elements (${elements.filter(e => e.visible).length} visible)`
      };
    }
    case 'detect_forms': {
      const forms = await detectForms();
      return { forms, summary: `Found ${forms.length} forms` };
    }
    case 'click_element': {
      let clicked;
      if (args.text) {
        const el = await findElement(args.text);
        if (!el) throw new Error(`No element: "${args.text}"`);
        await page.mouse.click(el.x, el.y);
        clicked = el;
      } else {
        await page.mouse.click(args.x, args.y);
        clicked = { x: args.x, y: args.y };
      }
      await new Promise(r => setTimeout(r, 1000));
      const img = await getScreenshot();
      return { type: 'combo', clicked, screenshot: img };
    }
    case 'type_text': {
      if (args.into) {
        const el = await findElement(args.into);
        if (el) await page.mouse.click(el.x, el.y);
      }
      await page.keyboard.type(args.text, { delay: 30 });
      if (args.pressEnter) await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 500));
      const img = await getScreenshot();
      return { type: 'combo', typed: args.text, screenshot: img };
    }
    case 'scroll': {
      const delta = args.direction === 'up' ? -(args.amount || 500) : (args.amount || 500);
      await page.evaluate(d => window.scrollBy(0, d), delta);
      await new Promise(r => setTimeout(r, 300));
      const img = await getScreenshot();
      return { type: 'combo', scrolled: args.direction, screenshot: img };
    }
    case 'wait': {
      if (args.selector) await page.waitForSelector(args.selector, { timeout: args.ms || 10000 });
      else if (args.ms) await new Promise(r => setTimeout(r, args.ms));
      return { waited: args.ms || args.selector };
    }
    case 'automate': {
      return await automate(args.goal, args);
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ========== REST API ==========
app.post('/automate', async (req, res) => {
  const { goal, startUrl, credentials, maxSteps } = req.body;
  if (!goal) return res.status(400).json({ error: 'goal is required' });
  
  console.log(`🤖 Automation v4.0: ${goal}`);
  const startTime = Date.now();
  const result = await automate(goal, { startUrl, credentials, maxSteps });
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${result.success ? '✅' : '❌'} ${result.steps} steps, ${duration}s`);
  res.json(result);
});

app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connection', sessionId: uuidv4() })}\n\n`);
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 30000);
  req.on('close', () => clearInterval(keepAlive));
});

app.post('/message', async (req, res) => {
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'computer-use-mcp', version: '4.0.0' } };
        break;
      case 'tools/list':
        result = { tools };
        break;
      case 'tools/call':
        const toolResult = await handleTool(params.name, params.arguments || {});
        if (toolResult.type === 'image') {
          result = { content: [{ type: 'image', data: toolResult.data, mimeType: toolResult.mimeType }] };
        } else if (toolResult.type === 'combo') {
          const { screenshot, ...rest } = toolResult;
          result = { content: [{ type: 'text', text: JSON.stringify(rest, null, 2) }, { type: 'image', data: screenshot, mimeType: 'image/png' }] };
        } else {
          result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        }
        break;
      default: throw new Error(`Unknown method: ${method}`);
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
});

app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  version: '4.0.0',
  browser: !!browser,
  improvements: [
    'screenshot_diffing',
    'form_intelligence', 
    'element_caching',
    'action_history',
    'smart_elements',
    'page_change_detection',
    'structured_tool_use',
    'progressive_goals',
    'retry_variation'
  ]
}));

// ========== START ==========
const PORT = process.env.PORT || 8080;
initBrowser().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Computer Use MCP v4.0.0 on port ${PORT}`);
    console.log(`✨ New: screenshot_diffing, form_intelligence, element_caching`);
  });
});
