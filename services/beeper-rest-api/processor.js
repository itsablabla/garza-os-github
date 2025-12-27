#!/usr/bin/env node
/**
 * Beeper Message Processor v1.0
 * Polls for due messages and sends via Beeper MCP
 */

const https = require('https');
const http = require('http');
const EventSource = require('eventsource');

const SCHEDULER_API = 'https://beeper-api.garzahive.com';
const BEEPER_MCP = 'http://127.0.0.1:23373/sse';

// Fetch due messages
async function getDueMessages() {
  return new Promise((resolve, reject) => {
    https.get(`${SCHEDULER_API}/due`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Update message status
async function updateStatus(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SCHEDULER_API);
    const payload = JSON.stringify(body);
    
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Send message via Beeper MCP (SSE)
async function sendViaBeeperMCP(chatId, text, replyTo = null) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
    
    // Create SSE connection
    const es = new EventSource(BEEPER_MCP);
    let sessionId = null;
    
    es.onopen = () => {
      console.log('SSE connected');
    };
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Get session endpoint
        if (data.endpoint) {
          sessionId = data.endpoint;
          // Now send the tool call
          const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: 'send_message',
              arguments: { chatID: chatId, text: text, replyToMessageID: replyTo }
            }
          });
          
          http.request({
            hostname: '127.0.0.1',
            port: 23373,
            path: sessionId,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }, (res) => {
            let respData = '';
            res.on('data', chunk => respData += chunk);
            res.on('end', () => {
              clearTimeout(timeout);
              es.close();
              resolve({ sent: true, response: respData });
            });
          }).on('error', (e) => {
            clearTimeout(timeout);
            es.close();
            reject(e);
          }).end(payload);
        }
        
        // Check for result
        if (data.result || data.error) {
          clearTimeout(timeout);
          es.close();
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      } catch (e) {
        // Not JSON, ignore
      }
    };
    
    es.onerror = (err) => {
      clearTimeout(timeout);
      es.close();
      reject(new Error('SSE error'));
    };
  });
}

// Alternative: Direct HTTP to Beeper local API
async function sendDirect(chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chatID: chatId, text: text });
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: 23373,
      path: '/api/send',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve({ sent: true });
        else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });
    
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Main processor
async function process() {
  console.log(`[${new Date().toISOString()}] Checking for due messages...`);
  
  try {
    const { messages } = await getDueMessages();
    
    if (!messages || messages.length === 0) {
      console.log('No messages due');
      return;
    }
    
    console.log(`Found ${messages.length} due message(s)`);
    
    for (const msg of messages) {
      console.log(`Processing message ${msg.id} to ${msg.recipient_name || msg.chat_id}`);
      
      try {
        // Try sending - for now just mark as needing manual send
        // TODO: Integrate with actual Beeper sending once we figure out the API
        console.log(`  Would send: "${msg.message_text.slice(0, 50)}..."`);
        
        // For now, just log - actual sending needs Claude's Beeper tools
        console.log(`  Message ${msg.id} needs manual processing via Claude`);
        
      } catch (err) {
        console.error(`  Failed: ${err.message}`);
        await updateStatus('/failed', { id: msg.id, error: err.message });
      }
    }
  } catch (err) {
    console.error('Processor error:', err.message);
  }
}

// Run once
process().then(() => {
  console.log('Done');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
