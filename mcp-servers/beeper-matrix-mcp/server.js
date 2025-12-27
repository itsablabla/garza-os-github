import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as sdk from 'matrix-js-sdk';
import crypto from 'crypto';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'beeper-matrix-mcp-key';
const MATRIX_HOMESERVER = process.env.MATRIX_HOMESERVER || 'https://matrix.beeper.com';
const MATRIX_USER_ID = process.env.MATRIX_USER_ID || '@jadengarza:beeper.com';
const MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;

let matrixClient = null;
let roomCache = null;
let roomCacheTime = 0;

function getMatrixClient() {
  if (!matrixClient) {
    matrixClient = sdk.createClient({
      baseUrl: MATRIX_HOMESERVER,
      accessToken: MATRIX_ACCESS_TOKEN,
      userId: MATRIX_USER_ID,
    });
  }
  return matrixClient;
}

// Base64url to Buffer conversion
function base64urlToBuffer(str) {
  let padded = str;
  while (padded.length % 4 !== 0) padded += '=';
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

// Download and decrypt Matrix media
async function downloadAndDecryptMedia(srcURL) {
  const [mxcPart, queryPart] = srcURL.split('?');
  
  if (!queryPart || !queryPart.includes('encryptedFileInfoJSON=')) {
    // Unencrypted - direct download
    const httpUrl = mxcPart.replace('mxc://', `${MATRIX_HOMESERVER}/_matrix/media/v3/download/`);
    const response = await fetch(httpUrl, {
      headers: { 'Authorization': `Bearer ${MATRIX_ACCESS_TOKEN}` },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return { 
      data: Buffer.from(await response.arrayBuffer()), 
      encrypted: false,
      mxc: mxcPart
    };
  }
  
  // Parse encryption info from URL
  const encInfoStr = decodeURIComponent(queryPart.split('encryptedFileInfoJSON=')[1]);
  const encInfo = JSON.parse(encInfoStr);
  
  // Convert mxc to HTTP
  const httpUrl = encInfo.url.replace('mxc://', `${MATRIX_HOMESERVER}/_matrix/media/v3/download/`);
  
  // Download encrypted file
  const response = await fetch(httpUrl, {
    headers: { 'Authorization': `Bearer ${MATRIX_ACCESS_TOKEN}` },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const encryptedData = Buffer.from(await response.arrayBuffer());
  
  // Decrypt using AES-256-CTR
  const key = base64urlToBuffer(encInfo.key.k);
  const iv = base64urlToBuffer(encInfo.iv);
  
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  
  return { 
    data: decrypted, 
    encrypted: true, 
    mxc: encInfo.url,
    algorithm: encInfo.key.alg
  };
}

// Cache rooms for 5 minutes
async function getCachedRooms() {
  const now = Date.now();
  if (roomCache && (now - roomCacheTime) < 300000) {
    return roomCache;
  }
  
  const client = getMatrixClient();
  const response = await client.getJoinedRooms();
  const rooms = [];
  
  // Fetch room names in parallel batches
  const batchSize = 50;
  for (let i = 0; i < response.joined_rooms.length; i += batchSize) {
    const batch = response.joined_rooms.slice(i, i + batchSize);
    const promises = batch.map(async (roomId) => {
      try {
        const stateEvents = await client.roomState(roomId);
        const nameEvent = stateEvents.find(e => e.type === 'm.room.name');
        const canonicalEvent = stateEvents.find(e => e.type === 'm.room.canonical_alias');
        return {
          room_id: roomId,
          name: nameEvent?.content?.name || canonicalEvent?.content?.alias || roomId
        };
      } catch {
        return { room_id: roomId, name: roomId };
      }
    });
    const results = await Promise.all(promises);
    rooms.push(...results);
  }
  
  roomCache = rooms;
  roomCacheTime = now;
  return rooms;
}

// Pre-warm cache on startup
setTimeout(async () => {
  try {
    console.log('Pre-warming room cache...');
    await getCachedRooms();
    console.log(`Cached ${roomCache.length} rooms`);
  } catch (e) {
    console.error('Cache pre-warm failed:', e.message);
  }
}, 5000);

const TOOLS = [
  {
    name: 'matrix_send_message',
    description: 'Send a text message to a Matrix room',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Matrix room ID' },
        message: { type: 'string', description: 'Message text' },
        reply_to: { type: 'string', description: 'Event ID to reply to (optional)' }
      },
      required: ['room_id', 'message']
    }
  },
  {
    name: 'matrix_edit_message',
    description: 'Edit an existing message',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        event_id: { type: 'string', description: 'Event ID of message to edit' },
        new_content: { type: 'string', description: 'New message text' }
      },
      required: ['room_id', 'event_id', 'new_content']
    }
  },
  {
    name: 'matrix_delete_message',
    description: 'Delete/redact a message',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        event_id: { type: 'string', description: 'Event ID to delete' },
        reason: { type: 'string', description: 'Reason for deletion (optional)' }
      },
      required: ['room_id', 'event_id']
    }
  },
  {
    name: 'matrix_get_messages',
    description: 'Get recent messages from a room',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        limit: { type: 'number', default: 50 },
        from: { type: 'string', description: 'Pagination token' }
      },
      required: ['room_id']
    }
  },
  {
    name: 'matrix_list_rooms',
    description: 'List all joined rooms',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'matrix_search_rooms',
    description: 'Search rooms by name (cached, fast)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'matrix_react',
    description: 'Add a reaction to a message',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        event_id: { type: 'string', description: 'Event ID to react to' },
        reaction: { type: 'string', description: 'Reaction emoji' }
      },
      required: ['room_id', 'event_id', 'reaction']
    }
  },
  {
    name: 'matrix_download_media',
    description: 'Convert mxc:// URL to HTTP URL',
    inputSchema: {
      type: 'object',
      properties: {
        mxc_url: { type: 'string' }
      },
      required: ['mxc_url']
    }
  },
  {
    name: 'matrix_get_attachment',
    description: 'Download and decrypt an attachment (voice memo, image, file). Returns base64 data.',
    inputSchema: {
      type: 'object',
      properties: {
        src_url: { type: 'string', description: 'Full srcURL from Beeper API (includes encryption key)' },
        return_info_only: { type: 'boolean', description: 'If true, only return metadata without downloading', default: false }
      },
      required: ['src_url']
    }
  },
  {
    name: 'matrix_send_read_receipt',
    description: 'Mark messages as read',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        event_id: { type: 'string', description: 'Event ID to mark as read up to' }
      },
      required: ['room_id', 'event_id']
    }
  },
  {
    name: 'matrix_get_room_state',
    description: 'Get room state (name, topic, members, etc)',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' }
      },
      required: ['room_id']
    }
  }
];

async function handleTool(name, args) {
  const client = getMatrixClient();
  
  switch (name) {
    case 'matrix_send_message': {
      const { room_id, message, reply_to } = args;
      const content = {
        msgtype: 'm.text',
        body: message
      };
      if (reply_to) {
        content['m.relates_to'] = {
          'm.in_reply_to': { event_id: reply_to }
        };
      }
      const result = await client.sendEvent(room_id, 'm.room.message', content);
      return { event_id: result.event_id, room_id };
    }
    
    case 'matrix_edit_message': {
      const { room_id, event_id, new_content } = args;
      const content = {
        msgtype: 'm.text',
        body: `* ${new_content}`,
        'm.new_content': {
          msgtype: 'm.text',
          body: new_content
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: event_id
        }
      };
      const result = await client.sendEvent(room_id, 'm.room.message', content);
      return { event_id: result.event_id, edited: event_id };
    }
    
    case 'matrix_delete_message': {
      const { room_id, event_id, reason } = args;
      const result = await client.redactEvent(room_id, event_id, undefined, { reason });
      return { redacted: event_id, redaction_id: result.event_id };
    }
    
    case 'matrix_get_messages': {
      const { room_id, limit = 50, from } = args;
      const response = await client.createMessagesRequest(room_id, from, limit, 'b');
      return {
        messages: response.chunk.map(e => ({
          event_id: e.event_id,
          sender: e.sender,
          type: e.type,
          content: e.content,
          timestamp: e.origin_server_ts,
          date: new Date(e.origin_server_ts).toISOString()
        })),
        end: response.end,
        start: response.start
      };
    }
    
    case 'matrix_list_rooms': {
      const rooms = await getCachedRooms();
      return { rooms, count: rooms.length, cached: true };
    }
    
    case 'matrix_search_rooms': {
      const { query } = args;
      const rooms = await getCachedRooms();
      const q = query.toLowerCase();
      const matches = rooms.filter(r => 
        r.name.toLowerCase().includes(q) || r.room_id.toLowerCase().includes(q)
      );
      return { matches, count: matches.length, query };
    }
    
    case 'matrix_react': {
      const { room_id, event_id, reaction } = args;
      const content = {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: event_id,
          key: reaction
        }
      };
      const result = await client.sendEvent(room_id, 'm.reaction', content);
      return { event_id: result.event_id, reacted_to: event_id, reaction };
    }
    
    case 'matrix_download_media': {
      const { mxc_url } = args;
      const httpUrl = client.mxcUrlToHttp(mxc_url);
      return { http_url: httpUrl, mxc_url };
    }
    
    case 'matrix_get_attachment': {
      const { src_url, return_info_only } = args;
      
      // Parse encryption info if present
      const hasEncryption = src_url.includes('encryptedFileInfoJSON=');
      
      if (return_info_only) {
        if (hasEncryption) {
          const encInfoStr = decodeURIComponent(src_url.split('encryptedFileInfoJSON=')[1]);
          const encInfo = JSON.parse(encInfoStr);
          return {
            encrypted: true,
            algorithm: encInfo.key.alg,
            mxc_url: encInfo.url,
            hash: encInfo.hashes?.sha256
          };
        }
        return { encrypted: false, mxc_url: src_url.split('?')[0] };
      }
      
      // Full download and decrypt
      const result = await downloadAndDecryptMedia(src_url);
      return {
        encrypted: result.encrypted,
        mxc_url: result.mxc,
        size: result.data.length,
        data_base64: result.data.toString('base64'),
        algorithm: result.algorithm
      };
    }
    
    case 'matrix_send_read_receipt': {
      const { room_id, event_id } = args;
      await client.sendReadReceipt({ roomId: room_id, eventId: event_id });
      return { success: true, room_id, event_id };
    }
    
    case 'matrix_get_room_state': {
      const { room_id } = args;
      const state = await client.roomState(room_id);
      const nameEvent = state.find(e => e.type === 'm.room.name');
      const topicEvent = state.find(e => e.type === 'm.room.topic');
      const members = state.filter(e => e.type === 'm.room.member' && e.content.membership === 'join');
      return {
        room_id,
        name: nameEvent?.content?.name,
        topic: topicEvent?.content?.topic,
        member_count: members.length,
        members: members.slice(0, 50).map(m => ({
          user_id: m.state_key,
          displayname: m.content.displayname
        }))
      };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// SSE connections map
const sseConnections = new Map();

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function authMiddleware(req, res, next) {
  const key = req.query.key || req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', tools: TOOLS.length, user: MATRIX_USER_ID, version: '1.2.0' });
});

app.get('/sse', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const sessionId = uuidv4();
  sseConnections.set(sessionId, res);
  sendSSE(res, 'endpoint', `/message?sessionId=${sessionId}`);
  
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 30000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseConnections.delete(sessionId);
  });
});

app.post('/message', authMiddleware, async (req, res) => {
  const { sessionId } = req.query;
  const sseRes = sseConnections.get(sessionId);
  const { jsonrpc, id, method, params } = req.body;
  
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'beeper-matrix-mcp', version: '1.2.0' },
          capabilities: { tools: {} }
        };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call':
        const { name, arguments: args } = params;
        const toolResult = await handleTool(name, args || {});
        result = { content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }] };
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    const response = { jsonrpc: '2.0', id, result };
    if (sseRes) sendSSE(sseRes, 'message', response);
    res.json(response);
  } catch (error) {
    const errorResponse = { jsonrpc: '2.0', id, error: { code: -32603, message: error.message } };
    if (sseRes) sendSSE(sseRes, 'message', errorResponse);
    res.json(errorResponse);
  }
});

app.listen(PORT, () => console.log(`Beeper Matrix MCP v1.2.0 running on port ${PORT}`));
