#!/usr/bin/env node
/**
 * Garza Ears v2.4 - Fly.io Edition
 */

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const CONFIG = {
  BEEPER_MCP_URL: 'https://beeper-mcp.garzahive.com/v0/mcp',
  BEEPER_MCP_KEY: process.env.BEEPER_MCP_KEY,
  OPENAI_KEY: process.env.OPENAI_KEY,
  ANTHROPIC_KEY: process.env.ANTHROPIC_KEY,
  POLL_INTERVAL_MS: 60000,
  STATE_FILE: '/data/state.json',
  MATRIX_HOMESERVER: 'matrix.beeper.com',
  MAX_CHATS: 20
};

let state = { processedIds: [], lastPoll: null };

function loadState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
      state.processedIds = state.processedIds || [];
    }
  } catch {}
}

function saveState() {
  try {
    state.processedIds = state.processedIds.slice(-500);
    state.lastPoll = new Date().toISOString();
    
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[Ears] State saved (${state.processedIds.length} IDs)`);
  } catch (e) {
    console.error(`[Ears] State save failed: ${e.message}`);
  }
}

async function beeperMCP(method, params) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: method, arguments: params }
    });
    const url = new URL(CONFIG.BEEPER_MCP_URL);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${CONFIG.BEEPER_MCP_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          let result = null;
          for (const line of data.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.slice(6).trim());
                if (json.result?.content?.[0]?.text) {
                  const text = json.result.content[0].text;
                  try { result = JSON.parse(text); } 
                  catch { result = { _text: text }; }
                }
              } catch {}
            }
          }
          resolve(result || { items: [], chats: [] });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseChatsFromText(text) {
  const chats = [];
  const regex = /## (.+?) \(chatID: ([^)]+)\)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    chats.push({ name: m[1], id: m[2] });
  }
  return chats;
}

function httpsGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    https.get(url, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpsGet(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function decryptMatrix(buf, encInfo) {
  const key = Buffer.from(encInfo.key.k.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ivRaw = Buffer.from(encInfo.iv.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const iv = Buffer.alloc(16, 0);
  ivRaw.copy(iv, 0, 0, Math.min(ivRaw.length, 16));
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([decipher.update(buf), decipher.final()]);
}

async function downloadAudio(srcURL) {
  if (!srcURL || !srcURL.startsWith('mxc://')) throw new Error('Invalid URL');
  const [mxcPart, query] = srcURL.split('?');
  const path = mxcPart.slice(6);
  const [server, ...rest] = path.split('/');
  const mediaId = rest.join('/');
  const url = `https://${CONFIG.MATRIX_HOMESERVER}/_matrix/media/v3/download/${server}/${mediaId}`;
  
  const buf = await httpsGet(url);
  
  if (query) {
    const params = new URLSearchParams(query);
    const encB64 = params.get('encryptedFileInfoJSON');
    if (encB64) {
      const encInfo = JSON.parse(Buffer.from(encB64, 'base64').toString('utf8'));
      return decryptMatrix(buf, encInfo);
    }
  }
  return buf;
}

async function transcribe(buf) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buf, { filename: 'audio.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com', path: '/v1/audio/transcriptions', method: 'POST',
      headers: { 'Authorization': `Bearer ${CONFIG.OPENAI_KEY}`, ...form.getHeaders() }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) reject(new Error(j.error.message));
          else resolve(j.text || '');
        } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

async function summarize(text, sender, chat) {
  const sys = sender === 'jaden' 
    ? `Extract key points and action items from Jaden's voice memo to "${chat}". Be concise.`
    : `Summarize voice memo received by Jaden in "${chat}". Key points/requests. Be concise.`;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 800, system: sys,
      messages: [{ role: 'user', content: `Transcript:\n\n${text}` }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': CONFIG.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).content?.[0]?.text || text); } 
        catch { resolve(text); }
      });
    });
    req.on('error', () => resolve(text));
    req.write(payload);
    req.end();
  });
}

async function processChat(chatID, chatName) {
  let count = 0;
  try {
    const result = await beeperMCP('list_messages', { chatID });
    const items = result.items || [];
    
    for (const msg of items) {
      if (state.processedIds.includes(msg.id)) continue;
      if (!msg.attachments || msg.attachments.length === 0) continue;
      
      for (const att of msg.attachments) {
        const isAudio = att.type === 'audio' || att.isVoiceNote || 
          (att.mimeType && att.mimeType.startsWith('audio/')) ||
          (att.fileName && /\.(ogg|opus|m4a|mp3|wav|aac)$/i.test(att.fileName));
        
        if (!isAudio || !att.srcURL) continue;
        
        const sender = msg.isSender ? 'jaden' : 'other';
        const name = msg.senderName || 'Unknown';
        const ts = new Date(msg.timestamp).toLocaleString();
        const kb = att.fileSize ? (att.fileSize/1024).toFixed(0) : '?';
        
        console.log(`\n[Ears] 🎤 ${sender.toUpperCase()} → "${chatName}"`);
        console.log(`[Ears]    ${name} @ ${ts} (${kb}KB)`);
        
        try {
          const audio = await downloadAudio(att.srcURL);
          if (audio.slice(0,4).toString() !== 'OggS') {
            console.log(`[Ears]    ⚠️ Not OGG format`);
            state.processedIds.push(msg.id);
            continue;
          }
          
          const text = await transcribe(audio);
          if (!text || text.length < 5) {
            console.log(`[Ears]    ⚠️ Empty transcript`);
            state.processedIds.push(msg.id);
            continue;
          }
          
          console.log(`[Ears]    📝 "${text.substring(0, 60)}..."`);
          const summary = await summarize(text, sender, chatName);
          console.log(`[Ears]    ✅ SUMMARY:`);
          summary.split('\n').slice(0,10).forEach(l => console.log(`[Ears]       ${l}`));
          count++;
        } catch (e) {
          console.error(`[Ears]    ❌ ${e.message}`);
        }
        state.processedIds.push(msg.id);
      }
    }
  } catch (e) {}
  return count;
}

async function poll() {
  console.log(`\n[Ears] ═══ ${new Date().toLocaleTimeString()} ═══`);
  
  try {
    const result = await beeperMCP('search_chats', { limit: CONFIG.MAX_CHATS, inbox: 'primary' });
    
    let chats = [];
    if (result._text) {
      chats = parseChatsFromText(result._text);
    } else if (result.chats) {
      chats = result.chats.map(c => ({ id: c.id || c.chatID, name: c.name || c.title }));
    }
    
    if (chats.length === 0) {
      console.log(`[Ears] No chats found`);
      saveState();
      return;
    }
    
    console.log(`[Ears] Scanning ${chats.length} chats...`);
    
    let total = 0;
    for (const chat of chats) {
      total += await processChat(chat.id, chat.name);
    }
    
    if (total > 0) console.log(`\n[Ears] ✅ Processed ${total} voice memo(s)`);
    else console.log(`[Ears] No new voice memos`);
    
    saveState();
  } catch (e) {
    console.error(`[Ears] Poll error: ${e.message}`);
    saveState();
  }
}

async function main() {
  console.log('🎧 Garza Ears v2.4 (Fly.io)');
  if (!CONFIG.OPENAI_KEY || !CONFIG.ANTHROPIC_KEY || !CONFIG.BEEPER_MCP_KEY) {
    console.error('[Ears] Missing API keys'); process.exit(1);
  }
  loadState();
  console.log(`[Ears] ${state.processedIds.length} processed IDs`);
  await poll();
  setInterval(poll, CONFIG.POLL_INTERVAL_MS);
  console.log(`[Ears] Polling every ${CONFIG.POLL_INTERVAL_MS/1000}s`);
}

main().catch(e => console.error('[Ears] Fatal:', e));
