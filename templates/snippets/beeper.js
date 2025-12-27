/**
 * Beeper Integration Snippets
 * Copy these into your MCP server
 */

// =============================================================================
// CONFIG
// =============================================================================
const BEEPER_API = process.env.BEEPER_API || 'http://localhost:8765';
const BEEPER_KEY = process.env.BEEPER_KEY || 'garza-beeper-2024';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================
const beeperTools = [
  {
    name: 'beeper_send_message',
    description: 'Send a message via Beeper',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Chat ID to send to' },
        text: { type: 'string', description: 'Message text' },
        replyTo: { type: 'string', description: 'Optional message ID to reply to' }
      },
      required: ['chatId', 'text']
    }
  },
  {
    name: 'beeper_search_chats',
    description: 'Search Beeper chats',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'beeper_list_messages',
    description: 'List messages from a chat',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Chat ID' },
        limit: { type: 'number', description: 'Max messages (default 20)' }
      },
      required: ['chatId']
    }
  }
];

// =============================================================================
// HANDLERS
// =============================================================================
async function beeperRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'X-API-Key': BEEPER_KEY,
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(`${BEEPER_API}${endpoint}`, options);
  if (!response.ok) throw new Error(`Beeper API error: ${response.status}`);
  return response.json();
}

async function handleBeeperTool(name, args) {
  switch (name) {
    case 'beeper_send_message':
      const sendResult = await beeperRequest('/send', 'POST', {
        chatID: args.chatId,
        text: args.text,
        replyToMessageID: args.replyTo
      });
      return { content: [{ type: 'text', text: JSON.stringify(sendResult) }] };
    
    case 'beeper_search_chats':
      const searchResult = await beeperRequest(`/chats/search?q=${encodeURIComponent(args.query)}&limit=${args.limit || 10}`);
      return { content: [{ type: 'text', text: JSON.stringify(searchResult) }] };
    
    case 'beeper_list_messages':
      const messages = await beeperRequest(`/chats/${encodeURIComponent(args.chatId)}/messages?limit=${args.limit || 20}`);
      return { content: [{ type: 'text', text: JSON.stringify(messages) }] };
    
    default:
      return null;
  }
}

module.exports = { beeperTools, handleBeeperTool };
