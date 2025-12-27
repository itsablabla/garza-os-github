#!/usr/bin/env node
/**
 * Jaden Responder - Smart Watcher (v2.3)
 */

const fs = require('fs');
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
    return { last_msg_id: null, responses_this_hour: 0, hour_started: Date.now() };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function beeperRequest(path, config, method = 'GET', body = null) {
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
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function callSmartResponder(senderName, conversationHistory, config) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.backend_url);
    const body = JSON.stringify({
      senderName,
      conversationHistory,
      apiKey: config.anthropic_key
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildConversation(messages, myUserId) {
  const sorted = [...messages].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  const conversation = [];
  
  for (const msg of sorted) {
    if (!msg.text) continue;
    const isMe = msg.isSender || msg.senderID === myUserId;
    const role = isMe ? 'assistant' : 'user';
    const content = isMe ? msg.text : `${msg.senderName}: ${msg.text}`;
    
    if (conversation.length > 0 && conversation[conversation.length - 1].role === role) {
      conversation[conversation.length - 1].content += '\n' + content;
    } else {
      conversation.push({ role, content });
    }
  }
  
  return conversation;
}

async function poll() {
  log('poll() called');
  
  try {
    const config = loadConfig();
    
    if (!config.active) {
      log('Watcher inactive');
      return;
    }
    
    if (config.expires_at && new Date(config.expires_at) < new Date()) {
      log('Watcher expired');
      return;
    }
    
    const state = loadState();
    
    // Rate limit
    const hourMs = 60 * 60 * 1000;
    if (Date.now() - state.hour_started > hourMs) {
      state.responses_this_hour = 0;
      state.hour_started = Date.now();
    }
    
    if (state.responses_this_hour >= config.max_responses_per_hour) {
      log('Rate limit reached');
      return;
    }
    
    // Handle pending response
    if (pendingResponse && Date.now() >= pendingResponse.sendAt) {
      try {
        await beeperRequest(
          `/v1/chats/${encodeURIComponent(config.chat_id)}/messages`,
          config, 'POST', { text: pendingResponse.text }
        );
        log(`Sent: ${pendingResponse.text}`);
        state.responses_this_hour++;
        saveState(state);
      } catch (e) {
        log(`Send error: ${e.message}`);
      }
      pendingResponse = null;
      return;
    }
    
    if (pendingResponse) {
      log(`Waiting ${Math.round((pendingResponse.sendAt - Date.now()) / 1000)}s`);
      return;
    }
    
    // Get messages
    log('Fetching messages...');
    const data = await beeperRequest(
      `/v1/chats/${encodeURIComponent(config.chat_id)}/messages?limit=20`,
      config
    );
    
    const messages = data.items || [];
    if (!messages.length) {
      log('No messages');
      return;
    }
    
    const newest = messages[0];
    log(`Newest: ${newest.id} from ${newest.senderName} - isSender: ${newest.isSender}`);
    
    if (state.last_msg_id === newest.id) {
      log('Already seen');
      return;
    }
    
    if (newest.isSender) {
      log('From me, skipping');
      state.last_msg_id = newest.id;
      saveState(state);
      return;
    }
    
    log(`New msg from ${newest.senderName}: ${newest.text?.substring(0, 50)}...`);
    state.last_msg_id = newest.id;
    saveState(state);
    
    const conversation = buildConversation(messages, config.my_user_id);
    const senderName = newest.senderName?.split(' ')[0] || 'Unknown';
    log(`Calling backend for ${senderName}...`);
    
    const result = await callSmartResponder(senderName, conversation, config);
    
    if (result.error) {
      log(`Backend error: ${result.error}`);
      return;
    }
    
    if (result.action === 'skip' || result.skip) {
      log(`Skip: ${result.skipReason || result.confidence}`);
      return;
    }
    
    if (result.action === 'review') {
      log(`Review (${result.confidence}): ${result.response}`);
      return;
    }
    
    const minDelay = (config.response_delay_min || 45) * 1000;
    const maxDelay = (config.response_delay_max || 120) * 1000;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    
    pendingResponse = {
      text: result.response,
      sendAt: Date.now() + delay,
      confidence: result.confidence
    };
    
    log(`Queued (${result.confidence}%) in ${Math.round(delay/1000)}s: ${result.response}`);
    
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}

log('Smart Watcher v2.3 started');
poll();
setInterval(poll, 30000);
