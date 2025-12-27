#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const http = require('http');

// Get instance name from command line arg
const INSTANCE = process.argv[2] || 'default';
const BASE = process.env.HOME + '/chat-watcher';
const CONFIG_PATH = `${BASE}/config-${INSTANCE}.json`;
const STATE_PATH = `${BASE}/state-${INSTANCE}.json`;
const LOG_PATH = `${BASE}/watcher-${INSTANCE}.log`;

let pendingResponse = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${INSTANCE}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  console.log(line.trim());
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { last_event_id: null, responses_this_hour: 0, hour_started: Date.now() };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function beeperRequest(path, config, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.beeper_api);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${config.beeper_token}`,
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getMessages(config, limit = 20) {
  const res = await beeperRequest(`/v1/chats/${encodeURIComponent(config.chat_id)}/messages?limit=${limit}`, config);
  if (res.status !== 200) throw new Error(`Failed to get messages: ${res.status}`);
  return res.data.items || [];
}

async function sendMessage(config, text) {
  const res = await beeperRequest(`/v1/chats/${encodeURIComponent(config.chat_id)}/messages`, config, 'POST', { text });
  if (res.status !== 200 && res.status !== 201) throw new Error(`Failed to send: ${res.status}`);
  return res.data;
}

async function callClaude(config, conversationHistory) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: config.system_prompt,
      messages: conversationHistory
    });
    
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropic_key,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || '');
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pollOnce() {
  const config = loadConfig();
  
  if (!config.active) {
    log('Responder inactive, skipping');
    return;
  }
  
  if (config.expires_at && new Date(config.expires_at) < new Date()) {
    log('Responder expired, deactivating');
    config.active = false;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return;
  }
  
  const state = loadState();
  
  // Reset hourly counter
  if (Date.now() - state.hour_started > 3600000) {
    state.responses_this_hour = 0;
    state.hour_started = Date.now();
  }
  
  if (state.responses_this_hour >= (config.max_responses_per_hour || 20)) {
    log('Rate limit reached');
    return;
  }
  
  const messages = await getMessages(config);
  if (!messages.length) return;
  
  // Find newest message not from me
  const incoming = messages.filter(m => m.senderID !== config.my_user_id);
  if (!incoming.length) return;
  
  const newest = incoming[0];
  
  // Skip if already processed
  if (state.last_event_id === newest.id) return;
  
  // Skip if message is old (> 5 min)
  const msgAge = Date.now() - new Date(newest.timestamp).getTime();
  if (msgAge > 300000) {
    log(`Skipping old message (${Math.round(msgAge/1000)}s old)`);
    state.last_event_id = newest.id;
    saveState(state);
    return;
  }
  
  log(`New message from ${newest.senderName}: "${newest.text}"`);
  
  // Build conversation history (last 10 messages in chronological order)
  const history = messages.slice(0, 10).reverse().map(m => ({
    role: m.senderID === config.my_user_id ? 'assistant' : 'user',
    content: m.text || '[media]'
  }));
  
  // Add delay (45-120s) to seem human
  const delay = 45000 + Math.random() * 75000;
  log(`Waiting ${Math.round(delay/1000)}s before responding...`);
  await new Promise(r => setTimeout(r, delay));
  
  // Re-check if still newest (in case more messages came in)
  const freshMessages = await getMessages(config);
  const stillNewest = freshMessages.filter(m => m.senderID !== config.my_user_id)[0];
  if (stillNewest?.id !== newest.id) {
    log('Newer message arrived, skipping this one');
    return;
  }
  
  const response = await callClaude(config, history);
  if (!response) {
    log('Empty response from Claude');
    return;
  }
  
  log(`Sending: "${response}"`);
  await sendMessage(config, response);
  
  state.last_event_id = newest.id;
  state.responses_this_hour++;
  saveState(state);
}

async function main() {
  log(`Starting responder instance: ${INSTANCE}`);
  log(`Config: ${CONFIG_PATH}`);
  
  const config = loadConfig();
  log(`Watching chat: ${config.chat_name} (${config.chat_id})`);
  
  while (true) {
    try {
      await pollOnce();
    } catch (e) {
      log(`Error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, (loadConfig().poll_interval_seconds || 30) * 1000));
  }
}

main().catch(e => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
