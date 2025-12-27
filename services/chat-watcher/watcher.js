#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const http = require('http');

const BASE = process.env.HOME + '/chat-watcher';
const CONFIG_PATH = BASE + '/config.json';
const STATE_PATH = BASE + '/state.json';
const LOG_PATH = BASE + '/watcher.log';

let pendingResponse = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
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
          const json = JSON.parse(data);
          resolve(json.content?.[0]?.text || '');
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

function buildConversationHistory(messages, config) {
  // Messages come newest first, reverse for chronological order
  const chronological = [...messages].reverse();
  
  // Filter to text messages only and build Claude message format
  const history = [];
  
  for (const msg of chronological) {
    if (!msg.text) continue;
    
    const isMe = msg.senderID === config.my_user_id;
    const role = isMe ? 'assistant' : 'user';
    const content = isMe ? msg.text : `${msg.senderName}: ${msg.text}`;
    
    // Claude requires alternating roles, so merge consecutive same-role messages
    if (history.length > 0 && history[history.length - 1].role === role) {
      history[history.length - 1].content += '\n' + content;
    } else {
      history.push({ role, content });
    }
  }
  
  // Ensure conversation ends with user message (required by Claude)
  if (history.length > 0 && history[history.length - 1].role === 'assistant') {
    history.pop();
  }
  
  // Ensure conversation starts with user message
  if (history.length > 0 && history[0].role === 'assistant') {
    history.shift();
  }
  
  return history;
}

async function poll() {
  try {
    const config = loadConfig();
    let state = loadState();
    
    // Check if we have a pending response ready to send
    if (pendingResponse && Date.now() >= pendingResponse.replyAt) {
      log(`Sending delayed response...`);
      await sendMessage(config, pendingResponse.text);
      log('Message sent!');
      
      state.last_event_id = pendingResponse.sortKey;
      state.responses_this_hour++;
      saveState(state);
      pendingResponse = null;
      return;
    }
    
    if (pendingResponse) {
      const waitSecs = Math.round((pendingResponse.replyAt - Date.now()) / 1000);
      log(`Waiting ${waitSecs}s before responding...`);
      return;
    }
    
    if (!config.active) {
      log('Watcher inactive');
      return;
    }
    
    if (new Date() > new Date(config.expires_at)) {
      log('Watch period expired');
      config.active = false;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      return;
    }
    
    if (Date.now() - state.hour_started > 3600000) {
      state.responses_this_hour = 0;
      state.hour_started = Date.now();
    }
    
    if (state.responses_this_hour >= config.max_responses_per_hour) {
      log('Rate limit reached');
      return;
    }
    
    const messages = await getMessages(config, 20);
    
    const newMessages = messages.filter(m => 
      m.senderID !== config.my_user_id && 
      (!state.last_event_id || m.sortKey > state.last_event_id)
    );
    
    if (newMessages.length === 0) {
      log('No new messages');
      return;
    }
    
    const msg = newMessages[newMessages.length - 1];
    log(`New message from ${msg.senderName}: ${msg.text?.substring(0, 50)}...`);
    
    if (!msg.text) {
      log('Skipping non-text message');
      state.last_event_id = msg.sortKey;
      saveState(state);
      return;
    }
    
    // Build conversation history from last 20 messages
    const conversationHistory = buildConversationHistory(messages, config);
    log(`Built conversation with ${conversationHistory.length} turns`);
    
    const reply = await callClaude(config, conversationHistory);
    log(`Claude reply ready: ${reply.substring(0, 50)}...`);
    
    // Random delay 45-120 seconds
    const delaySecs = 45 + Math.floor(Math.random() * 75);
    log(`Will send in ${delaySecs} seconds...`);
    
    pendingResponse = {
      replyAt: Date.now() + (delaySecs * 1000),
      text: reply,
      sortKey: msg.sortKey
    };
    
  } catch (err) {
    log(`Error: ${err.message}`);
  }
}

log('Chat watcher started');
poll();
setInterval(poll, 30000);
