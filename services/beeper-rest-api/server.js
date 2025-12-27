#!/usr/bin/env node
/**
 * Beeper Scheduler REST API v1.2
 * Queue management + D1 integration
 */

const http = require('http');
const https = require('https');

const PORT = 23380;
const CF_ACCOUNT = '14adde85f76060c6edef6f3239d36e6a';
const CF_DB_ID = 'b09efd12-2be0-4d90-8a7a-dc4fcf16fc85';
const D1_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${CF_DB_ID}/query`;
const CF_TOKEN = '30e198cf037ffd6accc4aa739e6d9b448e23aa67cd4070503eb06c0acb5235be';

async function d1Query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ sql, params });
    const url = new URL(D1_API);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success && parsed.result && parsed.result[0]) {
            resolve(parsed.result[0]);
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Parse error: ' + data.slice(0, 200)));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.write(payload);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  
  const sendJson = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  
  let body = {};
  if (req.method === 'POST') {
    body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({}); } });
    });
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  try {
    if (path === '/' || path === '/health') {
      sendJson({ status: 'ok', service: 'beeper-scheduler-api', v: '1.2', port: PORT });
      return;
    }
    
    // Schedule a message
    if (path === '/schedule' && req.method === 'POST') {
      const { chat_id, text, scheduled_at, recipient_name, notes, priority } = body;
      if (!chat_id || !text || !scheduled_at) {
        sendJson({ error: 'Missing chat_id, text, or scheduled_at' }, 400);
        return;
      }
      const result = await d1Query(
        "INSERT INTO beeper_message_queue (chat_id, message_text, status, scheduled_at, recipient_name, notes, priority) VALUES (?, ?, 'scheduled', ?, ?, ?, ?)",
        [chat_id, text, scheduled_at, recipient_name || null, notes || null, priority || 0]
      );
      sendJson({ success: true, id: result.meta?.last_row_id, scheduled_at });
      return;
    }
    
    // View queue
    if (path === '/queue') {
      const status = url.searchParams.get('status') || body.status || 'scheduled';
      let result;
      if (status === 'all') {
        result = await d1Query("SELECT * FROM beeper_message_queue ORDER BY id DESC LIMIT 50");
      } else {
        result = await d1Query("SELECT * FROM beeper_message_queue WHERE status = ? ORDER BY scheduled_at ASC LIMIT 50", [status]);
      }
      sendJson({ messages: result.results || [] });
      return;
    }
    
    // Get due messages
    if (path === '/due') {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const result = await d1Query(
        "SELECT * FROM beeper_message_queue WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY priority DESC, scheduled_at ASC LIMIT 20",
        [now]
      );
      sendJson({ messages: result.results || [], checked_at: now });
      return;
    }
    
    // Mark as sent
    if (path === '/sent' && req.method === 'POST') {
      const { id } = body;
      if (!id) { sendJson({ error: 'Missing id' }, 400); return; }
      const result = await d1Query(
        "UPDATE beeper_message_queue SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [id]
      );
      sendJson({ success: result.meta?.changes > 0 });
      return;
    }
    
    // Mark as failed
    if (path === '/failed' && req.method === 'POST') {
      const { id, error } = body;
      if (!id) { sendJson({ error: 'Missing id' }, 400); return; }
      const result = await d1Query(
        "UPDATE beeper_message_queue SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?",
        [error || 'Unknown error', id]
      );
      sendJson({ success: result.meta?.changes > 0 });
      return;
    }
    
    // Cancel
    if (path === '/cancel' && req.method === 'POST') {
      const { id } = body;
      if (!id) { sendJson({ error: 'Missing id' }, 400); return; }
      const result = await d1Query(
        "UPDATE beeper_message_queue SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'",
        [id]
      );
      sendJson({ success: result.meta?.changes > 0 });
      return;
    }
    
    sendJson({ error: 'Not found', endpoints: ['GET /health', 'POST /schedule', 'GET /queue', 'GET /due', 'POST /sent', 'POST /failed', 'POST /cancel'] }, 404);
    
  } catch (err) {
    sendJson({ error: err.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Beeper Scheduler API v1.2 running on port ${PORT}`);
});
