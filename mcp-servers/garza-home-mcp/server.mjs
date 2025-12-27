import "dotenv/config";
import express from 'express';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import * as sdk from 'matrix-js-sdk';
import fs from 'fs';

const app = express();
app.use(express.json({ limit: '50mb' }));

// ============ MULTI-HOUSE UNIFI CONFIG ============
const HOUSES = {
  boulder: {
    name: "Boulder House",
    host: process.env.UNIFI_HOST_BOULDER || "protect.garzahive.com",
    apiKey: process.env.UNIFI_API_KEY_BOULDER || process.env.UNIFI_API_KEY,
    username: process.env.UNIFI_USER_BOULDER || "jaden",
    password: process.env.UNIFI_PASS_BOULDER || "ZCLknoadhcfLIDSfdsds223"
  }
  // Add more houses here when ready:
  // dallas: { name: "Dallas House", host: "protect-dallas.garzahive.com", apiKey: process.env.UNIFI_API_KEY_DALLAS }
};
const DEFAULT_HOUSE = 'boulder';

// Performance: Persistent HTTPS agent with keep-alive
import https from 'https';
const httpsAgent = new https.Agent({ 
  rejectUnauthorized: false, 
  keepAlive: true, 
  maxSockets: 10,
  timeout: 30000 
});

// Simple cache (5 second TTL for camera list, etc)
const cache = new Map();
function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

function getHouse(houseName) {
  const name = (houseName || DEFAULT_HOUSE).toLowerCase();
  const house = HOUSES[name];
  if (!house) throw new Error(`Unknown house: ${name}. Available: ${Object.keys(HOUSES).join(', ')}`);
  return house;
}

// ============ OTHER CONFIG ============
const API_KEY = process.env.API_KEY || 'dev-key';
const ABODE_TOKEN = process.env.ABODE_TOKEN;
const BEEPER_API_URL = process.env.BEEPER_API_URL || 'https://beeper-mcp.garzahive.com/v1';
const BEEPER_TOKEN = process.env.BEEPER_TOKEN || '3a48068b-e6df-4d9c-b39b-0e41979edaa7';
const MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;
const MATRIX_HOMESERVER = process.env.MATRIX_HOMESERVER || 'https://matrix.beeper.com';
const MATRIX_USER_ID = process.env.MATRIX_USER_ID || '@jadengarza:beeper.com';
const PROTON_USER = process.env.PROTON_USER || 'jadengarza@pm.me';
const PROTON_PASS = process.env.PROTON_PASS;
const PROTON_IMAP_HOST = process.env.PROTON_IMAP_HOST || '127.0.0.1';
const PROTON_IMAP_PORT = parseInt(process.env.PROTON_IMAP_PORT || '1143');
const PROTON_SMTP_HOST = process.env.PROTON_SMTP_HOST || '127.0.0.1';
const PROTON_SMTP_PORT = parseInt(process.env.PROTON_SMTP_PORT || '1025');
const GRAPHITI_URL = process.env.GRAPHITI_URL;
const GRAPHITI_API_KEY = process.env.GRAPHITI_API_KEY;
// ============ MATRIX CLIENT ============
let matrixClient = null;
let roomCache = new Map();

async function initMatrix() {
  if (!MATRIX_ACCESS_TOKEN) {
    console.log('Matrix: No access token, skipping init');
    return null;
  }
  try {
    matrixClient = sdk.createClient({
      baseUrl: MATRIX_HOMESERVER,
      accessToken: MATRIX_ACCESS_TOKEN,
      userId: MATRIX_USER_ID,
    });
    console.log('Matrix: Client initialized');
    // Cache rooms in background
    cacheRooms().catch(e => console.error('Matrix room cache error:', e));
    return matrixClient;
  } catch (e) {
    console.error('Matrix init error:', e);
    return null;
  }
}

async function cacheRooms() {
  if (!matrixClient) return;
  const { joined_rooms } = await matrixClient.getJoinedRooms();
  const chunks = [];
  for (let i = 0; i < joined_rooms.length; i += 50) {
    chunks.push(joined_rooms.slice(i, i + 50));
  }
  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (roomId) => {
      try {
        const state = await matrixClient.roomState(roomId);
        const nameEvent = state.find(e => e.type === 'm.room.name');
        const members = state.filter(e => e.type === 'm.room.member' && e.content.membership === 'join');
        roomCache.set(roomId, {
          id: roomId,
          name: nameEvent?.content?.name || members.map(m => m.content.displayname || m.state_key).join(', ') || roomId,
          memberCount: members.length
        });
      } catch (e) {}
    }));
  }
  console.log(`Matrix: Cached ${roomCache.size} rooms`);
}

// ============ MATRIX HELPERS ============
function base64urlToBuffer(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64');
}

async function downloadAndDecryptMedia(srcUrl) {
  if (!MATRIX_ACCESS_TOKEN) throw new Error('MATRIX_ACCESS_TOKEN not configured');
  
  const url = new URL(srcUrl.startsWith('mxc://') ? `https://placeholder/${srcUrl}` : srcUrl);
  const encryptedInfoJSON = url.searchParams.get('encryptedFileInfoJSON');
  
  let mxcUrl = srcUrl.split('?')[0];
  let encInfo = null;
  
  if (encryptedInfoJSON) {
    encInfo = JSON.parse(decodeURIComponent(encryptedInfoJSON));
    if (encInfo.url) mxcUrl = encInfo.url;
  }
  
  // Convert mxc:// to HTTP URL
  const mxcMatch = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!mxcMatch) throw new Error('Invalid mxc URL');
  
  const httpUrl = `${MATRIX_HOMESERVER}/_matrix/media/v3/download/${mxcMatch[1]}/${mxcMatch[2]}`;
  
  const response = await fetch(httpUrl, {
    headers: { 'Authorization': `Bearer ${MATRIX_ACCESS_TOKEN}` }
  });
  
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  
  let data = Buffer.from(await response.arrayBuffer());
  
  // Decrypt if encrypted
  if (encInfo && encInfo.key && encInfo.iv) {
    const keyData = base64urlToBuffer(encInfo.key.k);
    const ivData = base64urlToBuffer(encInfo.iv);
    const decipher = crypto.createDecipheriv('aes-256-ctr', keyData, ivData);
    data = Buffer.concat([decipher.update(data), decipher.final()]);
  }
  
  return {
    data,
    encrypted: !!encInfo,
    size: data.length,
    mxcUrl,
    algorithm: encInfo?.key?.alg
  };
}

// ============ TOOL DEFINITIONS ============
const TOOLS = [
  { name: 'ping', description: 'Health check', inputSchema: { type: 'object', properties: {}, required: [] } },
  
  // ===== BEEPER REST API TOOLS =====
  { name: 'beeper_search', description: 'Search chats, participants, and messages', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search text' } }, required: ['query'] } },
  { name: 'beeper_search_chats', description: 'Search chats by title/network or participants', inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['titles', 'participants'] }, type: { type: 'string', enum: ['single', 'group', 'any'] }, inbox: { type: 'string', enum: ['primary', 'low-priority', 'archive'] }, unreadOnly: { type: 'boolean' }, limit: { type: 'number' } }, required: [] } },
  { name: 'beeper_search_messages', description: 'Search messages across chats', inputSchema: { type: 'object', properties: { query: { type: 'string' }, chatIDs: { type: 'array', items: { type: 'string' } }, chatType: { type: 'string', enum: ['group', 'single'] }, dateAfter: { type: 'string' }, dateBefore: { type: 'string' }, sender: { type: 'string' }, mediaTypes: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } }, required: [] } },
  { name: 'beeper_get_chat', description: 'Get chat details', inputSchema: { type: 'object', properties: { chatID: { type: 'string' }, maxParticipantCount: { type: 'number' } }, required: ['chatID'] } },
  { name: 'beeper_list_messages', description: 'List messages from chat (includes attachment URLs with encryption keys)', inputSchema: { type: 'object', properties: { chatID: { type: 'string' }, cursor: { type: 'string' }, direction: { type: 'string', enum: ['after', 'before'] } }, required: ['chatID'] } },
  { name: 'beeper_send_message', description: 'Send message to chat', inputSchema: { type: 'object', properties: { chatID: { type: 'string' }, text: { type: 'string' }, replyToMessageID: { type: 'string' } }, required: ['chatID', 'text'] } },
  { name: 'beeper_get_accounts', description: 'List connected accounts', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'beeper_archive_chat', description: 'Archive/unarchive chat', inputSchema: { type: 'object', properties: { chatID: { type: 'string' }, archived: { type: 'boolean' } }, required: ['chatID'] } },

  // ===== MATRIX SDK TOOLS (E2E Encrypted) =====
  { name: 'matrix_send_message', description: 'Send message via Matrix SDK', inputSchema: { type: 'object', properties: { room_id: { type: 'string' }, message: { type: 'string' }, msg_type: { type: 'string', enum: ['m.text', 'm.notice'] } }, required: ['room_id', 'message'] } },
  { name: 'matrix_get_messages', description: 'Get messages from Matrix room', inputSchema: { type: 'object', properties: { room_id: { type: 'string' }, limit: { type: 'number' }, from: { type: 'string' } }, required: ['room_id'] } },
  { name: 'matrix_list_rooms', description: 'List joined Matrix rooms', inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, required: [] } },
  { name: 'matrix_search_rooms', description: 'Search Matrix rooms by name', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'matrix_get_attachment', description: 'Download and decrypt Matrix attachment (voice memos, images, files). Use srcURL from beeper_list_messages.', inputSchema: { type: 'object', properties: { src_url: { type: 'string', description: 'Full srcURL from Beeper API including encryptedFileInfoJSON' }, return_info_only: { type: 'boolean', description: 'If true, return metadata without downloading' } }, required: ['src_url'] } },
  { name: 'matrix_react', description: 'React to a message', inputSchema: { type: 'object', properties: { room_id: { type: 'string' }, event_id: { type: 'string' }, emoji: { type: 'string' } }, required: ['room_id', 'event_id', 'emoji'] } },

  // ===== UNIFI PROTECT TOOLS =====
  { name: 'unifi_list_houses', description: 'List available houses', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'unifi_list_cameras', description: 'List all cameras', inputSchema: { type: 'object', properties: { house: { type: 'string', description: 'House name (default: boulder)' } }, required: [] } },
  { name: 'unifi_get_snapshot', description: 'Get camera snapshot', inputSchema: { type: 'object', properties: { camera_id: { type: 'string' }, house: { type: 'string', description: 'House name (default: boulder)' } }, required: ['camera_id'] } },
  { name: 'unifi_get_events', description: 'Get motion/detection events', inputSchema: { type: 'object', properties: { minutes_ago: { type: 'number' }, limit: { type: 'number' }, house: { type: 'string', description: 'House name (default: boulder)' } }, required: [] } },
  { name: 'unifi_system_info', description: 'Get UniFi Protect system info', inputSchema: { type: 'object', properties: { house: { type: 'string', description: 'House name (default: boulder)' } }, required: [] } },
  { name: 'unifi_list_sensors', description: 'List door/motion sensors', inputSchema: { type: 'object', properties: { house: { type: 'string' } }, required: [] } },
  { name: 'unifi_list_lights', description: 'List smart lights', inputSchema: { type: 'object', properties: { house: { type: 'string' } }, required: [] } },
  { name: 'unifi_set_light', description: 'Control smart light', inputSchema: { type: 'object', properties: { light_id: { type: 'string' }, on: { type: 'boolean' }, brightness: { type: 'number' }, house: { type: 'string' } }, required: ['light_id'] } },

  // ===== ABODE TOOLS =====
  { name: 'abode_get_mode', description: 'Get alarm mode', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'abode_set_mode', description: 'Set alarm mode', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['standby', 'home', 'away'] } }, required: ['mode'] } },
  { name: 'abode_list_devices', description: 'List devices', inputSchema: { type: 'object', properties: {}, required: [] } },

  // ===== PROTONMAIL TOOLS =====
  { name: 'search_protonmail', description: 'Search inbox', inputSchema: { type: 'object', properties: { criteria: { type: 'string' }, limit: { type: 'number' } }, required: [] } },
  { name: 'read_protonmail', description: 'Read message by UID', inputSchema: { type: 'object', properties: { uid: { type: 'number' } }, required: ['uid'] } },
  { name: 'send_protonmail', description: 'Send email', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  { name: 'list_protonmail_folders', description: 'List all folders/labels', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'archive_protonmail', description: 'Archive email (move to Archive)', inputSchema: { type: 'object', properties: { uid: { type: 'number' }, folder: { type: 'string', default: 'INBOX' } }, required: ['uid'] } },
  { name: 'delete_protonmail', description: 'Delete email (move to Trash)', inputSchema: { type: 'object', properties: { uid: { type: 'number' }, folder: { type: 'string', default: 'INBOX' } }, required: ['uid'] } },
  { name: 'mark_protonmail', description: 'Mark read/unread', inputSchema: { type: 'object', properties: { uid: { type: 'number' }, read: { type: 'boolean', default: true }, folder: { type: 'string', default: 'INBOX' } }, required: ['uid'] } },
  { name: 'star_protonmail', description: 'Star/unstar email', inputSchema: { type: 'object', properties: { uid: { type: 'number' }, starred: { type: 'boolean', default: true }, folder: { type: 'string', default: 'INBOX' } }, required: ['uid'] } },
  { name: 'move_protonmail', description: 'Move to folder', inputSchema: { type: 'object', properties: { uid: { type: 'number' }, destFolder: { type: 'string' }, sourceFolder: { type: 'string', default: 'INBOX' } }, required: ['uid', 'destFolder'] } },
  { name: 'bulk_protonmail', description: 'Bulk actions (archive|delete|mark_read|mark_unread|star|unstar|move)', inputSchema: { type: 'object', properties: { uids: { type: 'array', items: { type: 'number' } }, action: { type: 'string' }, folder: { type: 'string', default: 'INBOX' }, destFolder: { type: 'string' } }, required: ['uids', 'action'] } },

  // ===== BIBLE API TOOLS =====
  { name: 'bible_passage', description: 'Get passage', inputSchema: { type: 'object', properties: { reference: { type: 'string' }, version: { type: 'string' } }, required: ['reference'] } },
  { name: 'bible_search', description: 'Search Bible', inputSchema: { type: 'object', properties: { query: { type: 'string' }, version: { type: 'string' } }, required: ['query'] } },
  { name: 'bible_votd', description: 'Verse of the day', inputSchema: { type: 'object', properties: {}, required: [] } },

  // ===== GRAPHITI TOOLS =====
  { name: 'graphiti_search', description: 'Search knowledge graph', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'graphiti_add_episode', description: 'Add episode', inputSchema: { type: 'object', properties: { content: { type: 'string' }, source: { type: 'string' }, metadata: { type: 'object' } }, required: ['content'] } },
  { name: 'graphiti_get_facts', description: 'Get entity facts', inputSchema: { type: 'object', properties: { entity: { type: 'string' } }, required: ['entity'] } }
];

// ============ API HELPERS ============
async function beeperFetch(endpoint, method = 'GET', body = null) {
  if (!BEEPER_TOKEN) throw new Error('BEEPER_TOKEN not configured');
  const opts = { method, headers: { 'Authorization': `Bearer ${BEEPER_TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BEEPER_API_URL}${endpoint}`, opts);
  if (!res.ok) throw new Error(`Beeper error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function unifiFetch(endpoint, houseName = null, cacheTtlMs = 0) {
  const house = getHouse(houseName);
  if (!house.apiKey) throw new Error(`API key not configured for ${house.name}`);
  
  const cacheKey = `unifi:${house.name}:${endpoint}`;
  const doFetch = async () => {
    const res = await fetch(`https://${house.host}/proxy/protect/integration/v1${endpoint}`, {
      headers: { 'X-API-KEY': house.apiKey, 'Accept': 'application/json' }, agent: httpsAgent
    });
    if (!res.ok) throw new Error(`UniFi error (${house.name}): ${res.status}`);
    return res.json();
  };
  
  if (cacheTtlMs > 0) return cached(cacheKey, cacheTtlMs, doFetch);
  return doFetch();
}

async function unifiSnapshot(cameraId, houseName = null) {
  const house = getHouse(houseName);
  if (!house.apiKey) throw new Error(`API key not configured for ${house.name}`);
  
  
  const res = await fetch(`https://${house.host}/proxy/protect/integration/v1/cameras/${cameraId}/snapshot`, {
    headers: { 'X-API-KEY': house.apiKey }, agent: httpsAgent
  });
  if (!res.ok) throw new Error(`Snapshot error (${house.name}): ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { data: buffer.toString('base64'), mimeType: 'image/jpeg', house: house.name };
}

async function abodeFetch(endpoint, method = 'GET', body = null) {
  if (!ABODE_TOKEN) throw new Error('ABODE_TOKEN not configured');
  const opts = { method, headers: { 'Authorization': `Bearer ${ABODE_TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://my.goabode.com/api/v1${endpoint}`, opts);
  if (!res.ok) throw new Error(`Abode error: ${res.status}`);
  return res.json();
}

function createImap() {
  return new Imap({ user: PROTON_USER, password: PROTON_PASS, host: PROTON_IMAP_HOST, port: PROTON_IMAP_PORT, tls: true, tlsOptions: { rejectUnauthorized: false } });
}

async function searchProtonmail(criteria = 'ALL', limit = 10) {
  if (!PROTON_PASS) throw new Error('PROTON_PASS not configured');
  return new Promise((resolve, reject) => {
    const imap = createImap();
    const results = [];
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.search([criteria], (err, uids) => {
          if (err) { imap.end(); return reject(err); }
          const toFetch = uids.slice(-limit).reverse();
          if (!toFetch.length) { imap.end(); return resolve([]); }
          const f = imap.fetch(toFetch, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)', struct: true });
          f.on('message', (msg) => {
            let uid, headers = '';
            msg.on('body', (stream) => { stream.on('data', (c) => { headers += c.toString(); }); });
            msg.once('attributes', (attrs) => { uid = attrs.uid; });
            msg.once('end', () => { results.push({ uid, headers: headers.trim() }); });
          });
          f.once('end', () => { imap.end(); resolve(results); });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

async function readProtonmail(uid) {
  if (!PROTON_PASS) throw new Error('PROTON_PASS not configured');
  return new Promise((resolve, reject) => {
    const imap = createImap();
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { imap.end(); return reject(err); }
        const f = imap.fetch([uid], { bodies: '' });
        f.on('message', (msg) => {
          msg.on('body', async (stream) => {
            try {
              const parsed = await simpleParser(stream);
              resolve({ uid, from: parsed.from?.text, to: parsed.to?.text, subject: parsed.subject, date: parsed.date, text: parsed.text });
            } catch (e) { reject(e); }
          });
        });
        f.once('end', () => { imap.end(); });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

async function sendProtonmail({ to, subject, body, cc, bcc }) {
  if (!PROTON_PASS) throw new Error('PROTON_PASS not configured');
  const transporter = nodemailer.createTransport({ host: PROTON_SMTP_HOST, port: PROTON_SMTP_PORT, secure: true, auth: { user: PROTON_USER, pass: PROTON_PASS }, tls: { rejectUnauthorized: false } });
  const info = await transporter.sendMail({ from: PROTON_USER, to, cc, bcc, subject, text: body });
  return { messageId: info.messageId, accepted: info.accepted };
}

async function listProtonmailFolders() {
  if (!PROTON_PASS) throw new Error('PROTON_PASS not configured');
  return new Promise((resolve, reject) => {
    const imap = createImap();
    imap.once('ready', () => {
      imap.getBoxes((err, boxes) => {
        if (err) { imap.end(); return reject(err); }
        const folders = [];
        function extractFolders(boxObj, prefix = '') {
          for (const [name, box] of Object.entries(boxObj)) {
            const fullPath = prefix ? `${prefix}/${name}` : name;
            folders.push({ name: fullPath, delimiter: box.delimiter, flags: box.attribs });
            if (box.children) extractFolders(box.children, fullPath);
          }
        }
        extractFolders(boxes);
        imap.end();
        resolve(folders);
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

async function moveProtonmail(uid, sourceFolder, destFolder) {
  if (!PROTON_PASS) throw new Error('PROTON_PASS not configured');
  return new Promise((resolve, reject) => {
    const imap = createImap();
    imap.once('ready', () => {
      imap.openBox(sourceFolder, false, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.move(uid, destFolder, (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.end();
          resolve({ success: true, uid, movedTo: destFolder });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

async function setProtonmailFlags(uid, flags, add = true, folder = 'INBOX') {
  if (!PROTON_PASS) throw new Error('PROTON_PASS not configured');
  return new Promise((resolve, reject) => {
    const imap = createImap();
    imap.once('ready', () => {
      imap.openBox(folder, false, (err) => {
        if (err) { imap.end(); return reject(err); }
        const method = add ? imap.addFlags.bind(imap) : imap.delFlags.bind(imap);
        method(uid, flags, (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.end();
          resolve({ success: true, uid, flags, action: add ? 'added' : 'removed' });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

async function archiveProtonmail(uid, folder = 'INBOX') {
  return moveProtonmail(uid, folder, 'Archive');
}

async function deleteProtonmail(uid, folder = 'INBOX') {
  return moveProtonmail(uid, folder, 'Trash');
}

async function markProtonmail(uid, read = true, folder = 'INBOX') {
  return setProtonmailFlags(uid, ['\\Seen'], read, folder);
}

async function starProtonmail(uid, starred = true, folder = 'INBOX') {
  return setProtonmailFlags(uid, ['\\Flagged'], starred, folder);
}

async function bulkProtonmail(uids, action, folder = 'INBOX', destFolder = null) {
  const results = [];
  for (const uid of uids) {
    try {
      let result;
      switch (action) {
        case 'archive': result = await archiveProtonmail(uid, folder); break;
        case 'delete': result = await deleteProtonmail(uid, folder); break;
        case 'mark_read': result = await markProtonmail(uid, true, folder); break;
        case 'mark_unread': result = await markProtonmail(uid, false, folder); break;
        case 'star': result = await starProtonmail(uid, true, folder); break;
        case 'unstar': result = await starProtonmail(uid, false, folder); break;
        case 'move':
          if (!destFolder) throw new Error('destFolder required for move action');
          result = await moveProtonmail(uid, folder, destFolder);
          break;
        default: throw new Error(`Unknown action: ${action}`);
      }
      results.push({ uid, success: true, ...result });
    } catch (err) {
      results.push({ uid, success: false, error: err.message });
    }
  }
  return results;
}

async function biblePassage(ref, ver = 'KJV') {
  const res = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}?translation=${ver.toLowerCase()}`);
  return res.json();
}

async function graphitiFetch(endpoint, method = 'GET', body = null) {
  if (!GRAPHITI_URL) throw new Error('GRAPHITI_URL not configured');
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(GRAPHITI_API_KEY && { 'Authorization': `Bearer ${GRAPHITI_API_KEY}` }) } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${GRAPHITI_URL}${endpoint}`, opts);
  if (!res.ok) throw new Error(`Graphiti error: ${res.status}`);
  return res.json();
}

// ============ TOOL HANDLERS ============
async function handleTool(name, args) {
  switch (name) {
    case 'ping': return { status: 'ok', server: 'home-garzahive-v2', ts: new Date().toISOString(), matrix: !!matrixClient };
    
    // Beeper REST API
    case 'beeper_search': return beeperFetch(`/search?query=${encodeURIComponent(args.query)}`);
    case 'beeper_search_chats': {
      const p = new URLSearchParams();
      if (args.query) p.set('query', args.query);
      if (args.scope) p.set('scope', args.scope);
      if (args.type) p.set('type', args.type);
      if (args.inbox) p.set('inbox', args.inbox);
      if (args.unreadOnly) p.set('unreadOnly', 'true');
      if (args.limit) p.set('limit', args.limit);
      return beeperFetch(`/chats?${p}`);
    }
    case 'beeper_search_messages': {
      const p = new URLSearchParams();
      if (args.query) p.set('query', args.query);
      if (args.chatIDs) args.chatIDs.forEach(id => p.append('chatIDs', id));
      if (args.chatType) p.set('chatType', args.chatType);
      if (args.dateAfter) p.set('dateAfter', args.dateAfter);
      if (args.dateBefore) p.set('dateBefore', args.dateBefore);
      if (args.sender) p.set('sender', args.sender);
      if (args.mediaTypes) args.mediaTypes.forEach(t => p.append('mediaTypes', t));
      if (args.limit) p.set('limit', args.limit);
      return beeperFetch(`/messages/search?${p}`);
    }
    case 'beeper_get_chat': return beeperFetch(`/chats/${args.chatID}${args.maxParticipantCount !== undefined ? `?maxParticipantCount=${args.maxParticipantCount}` : ''}`);
    case 'beeper_list_messages': {
      const p = new URLSearchParams();
      if (args.cursor) p.set('cursor', args.cursor);
      if (args.direction) p.set('direction', args.direction);
      return beeperFetch(`/chats/${args.chatID}/messages?${p}`);
    }
    case 'beeper_send_message': return beeperFetch(`/chats/${args.chatID}/messages`, 'POST', { text: args.text, ...(args.replyToMessageID && { replyToMessageID: args.replyToMessageID }) });
    case 'beeper_get_accounts': return beeperFetch('/accounts');
    case 'beeper_archive_chat': return beeperFetch(`/chats/${args.chatID}/archive`, 'POST', { archived: args.archived ?? true });

    // Matrix SDK Tools
    case 'matrix_send_message': {
      if (!matrixClient) throw new Error('Matrix client not initialized');
      const content = { msgtype: args.msg_type || 'm.text', body: args.message };
      const result = await matrixClient.sendEvent(args.room_id, 'm.room.message', content);
      return { event_id: result.event_id, room_id: args.room_id };
    }
    case 'matrix_get_messages': {
      if (!matrixClient) throw new Error('Matrix client not initialized');
      const result = await matrixClient.createMessagesRequest(args.room_id, args.from || null, args.limit || 50, 'b');
      return {
        messages: result.chunk.map(e => ({
          event_id: e.event_id,
          sender: e.sender,
          type: e.type,
          content: e.content,
          timestamp: e.origin_server_ts
        })),
        end: result.end,
        start: result.start
      };
    }
    case 'matrix_list_rooms': {
      if (!matrixClient) throw new Error('Matrix client not initialized');
      const rooms = Array.from(roomCache.values());
      const limit = args.limit || 100;
      return { rooms: rooms.slice(0, limit), total: rooms.length };
    }
    case 'matrix_search_rooms': {
      if (!matrixClient) throw new Error('Matrix client not initialized');
      const query = args.query.toLowerCase();
      const matches = Array.from(roomCache.values()).filter(r => 
        r.name.toLowerCase().includes(query) || r.id.toLowerCase().includes(query)
      );
      return { rooms: matches, count: matches.length };
    }
    case 'matrix_get_attachment': {
      if (!MATRIX_ACCESS_TOKEN) throw new Error('Matrix not configured');
      
      // Parse srcURL to get encryption info
      const srcUrl = args.src_url;
      const url = new URL(srcUrl.startsWith('mxc://') ? `https://placeholder/${srcUrl}` : srcUrl);
      const encryptedInfoJSON = url.searchParams.get('encryptedFileInfoJSON');
      
      if (args.return_info_only) {
        let info = { encrypted: false, mxc_url: srcUrl.split('?')[0] };
        if (encryptedInfoJSON) {
          const encInfo = JSON.parse(decodeURIComponent(encryptedInfoJSON));
          info = {
            encrypted: true,
            algorithm: encInfo.key?.alg,
            mxc_url: encInfo.url || srcUrl.split('?')[0],
            hash: encInfo.hashes?.sha256
          };
        }
        return info;
      }
      
      // Full download and decrypt
      const result = await downloadAndDecryptMedia(srcUrl);
      return {
        encrypted: result.encrypted,
        mxc_url: result.mxcUrl,
        size: result.size,
        algorithm: result.algorithm,
        data_base64: result.data.toString('base64')
      };
    }
    case 'matrix_react': {
      if (!matrixClient) throw new Error('Matrix client not initialized');
      const content = {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: args.event_id,
          key: args.emoji
        }
      };
      const result = await matrixClient.sendEvent(args.room_id, 'm.reaction', content);
      return { event_id: result.event_id };
    }

    // UniFi (Multi-House)
    case 'unifi_list_houses': 
      return Object.entries(HOUSES).map(([id, h]) => ({ id, name: h.name, host: h.host }));
    case 'unifi_list_cameras': {
      const cameras = await unifiFetch('/cameras', args.house, 30000);
      if (args.slim) return cameras.map(c => ({ id: c.id, name: c.name, state: c.state }));
      return cameras;
    }
    case 'unifi_get_snapshot': return unifiSnapshot(args.camera_id, args.house);
    case 'unifi_get_events': {
      const start = args.minutes_ago ? Date.now() - (args.minutes_ago * 60 * 1000) : Date.now() - 3600000;
      return unifiFetch(`/events?start=${start}&end=${Date.now()}${args.limit ? `&limit=${args.limit}` : ''}`, args.house);
    }
    case 'unifi_system_info': return unifiFetch('/meta/info', args.house, 60000); // 60s cache
    case 'unifi_list_sensors': return unifiFetch('/sensors', args.house, 15000); // 15s cache
    case 'unifi_list_lights': return unifiFetch('/lights', args.house, 15000); // 15s cache
    case 'unifi_set_light': {
      const house = getHouse(args.house);
      
      
      const body = {};
      if (args.on !== undefined) body.isLightOn = args.on;
      if (args.brightness !== undefined) body.lightLevel = args.brightness;
      const res = await fetch(`https://${house.host}/proxy/protect/integration/v1/lights/${args.light_id}`, {
        method: 'PATCH', headers: { 'X-API-KEY': house.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), agent
      });
      return res.ok ? { success: true, house: house.name } : { error: `Failed: ${res.status}` };
    }

    // Abode
    // Abode
    case 'abode_get_mode': return abodeFetch('/panel');
    case 'abode_set_mode': return abodeFetch('/panel/mode', 'PUT', { mode: args.mode });
    case 'abode_list_devices': return abodeFetch('/devices');

    // ProtonMail
    case 'search_protonmail': return searchProtonmail(args.criteria || 'ALL', args.limit || 10);
    case 'read_protonmail': return readProtonmail(args.uid);
    case 'send_protonmail': return sendProtonmail(args);
    case 'list_protonmail_folders': return listProtonmailFolders();
    case 'archive_protonmail': return archiveProtonmail(args.uid, args.folder || 'INBOX');
    case 'delete_protonmail': return deleteProtonmail(args.uid, args.folder || 'INBOX');
    case 'mark_protonmail': return markProtonmail(args.uid, args.read !== false, args.folder || 'INBOX');
    case 'star_protonmail': return starProtonmail(args.uid, args.starred !== false, args.folder || 'INBOX');
    case 'move_protonmail': return moveProtonmail(args.uid, args.sourceFolder || 'INBOX', args.destFolder);
    case 'bulk_protonmail': return bulkProtonmail(args.uids, args.action, args.folder || 'INBOX', args.destFolder);

    // Bible
    case 'bible_passage': return biblePassage(args.reference, args.version);
    case 'bible_search': return biblePassage(args.query, args.version);
    case 'bible_votd': {
      const verses = ['John 3:16', 'Psalm 23:1', 'Philippians 4:13', 'Romans 8:28', 'Jeremiah 29:11'];
      return biblePassage(verses[new Date().getDate() % verses.length]);
    }

    // Graphiti
    case 'graphiti_search': return graphitiFetch('/search', 'POST', { query: args.query, limit: args.limit || 10 });
    case 'graphiti_add_episode': return graphitiFetch('/episodes', 'POST', { content: args.content, source: args.source || 'claude', metadata: args.metadata || {} });
    case 'graphiti_get_facts': return graphitiFetch(`/entities/${encodeURIComponent(args.entity)}/facts`);

    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ============ MCP ENDPOINTS ============
app.get('/health', (req, res) => res.json({ status: 'ok', server: 'home-garzahive-v2', tools: TOOLS.length, matrix: !!matrixClient }));

app.get('/sse', async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json({ error: 'Invalid key' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sid = `s-${Date.now()}`;
  res.write(`event: endpoint\ndata: /messages?sessionId=${sid}&key=${req.query.key}\n\n`);
  const ka = setInterval(() => res.write(`: keepalive\n\n`), 30000);
  req.on('close', () => clearInterval(ka));
});

app.post('/messages', async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json({ error: 'Invalid key' });
  const { method, params, id } = req.body;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'home-garzahive', version: '2.1.0' } };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call':
        const r = await handleTool(params.name, params.arguments || {});
        result = { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (e) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
});

// ============ START ============
const PORT = process.env.PORT || 3000;

async function start() {
  await initMatrix();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Home GarzaHive MCP v2.1 on port ${PORT}`);
    console.log(`Tools: ${TOOLS.length} | Matrix: ${matrixClient ? '✓' : '✗'} | Beeper: ${BEEPER_TOKEN ? '✓' : '✗'} | UniFi: ${HOUSES.boulder.apiKey ? '✓' : '✗'} | Abode: ${ABODE_TOKEN ? '✓' : '✗'} | Proton: ${PROTON_PASS ? '✓' : '✗'} | Graphiti: ${GRAPHITI_URL ? '✓' : '✗'}`);
  });
}

start();
