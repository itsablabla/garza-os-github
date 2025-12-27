/**
 * Craft Integration Snippets
 * Copy these into your MCP server
 */

// =============================================================================
// CONFIG
// =============================================================================
const CRAFT_SPACE_ID = process.env.CRAFT_SPACE_ID;
const CRAFT_TOKEN = process.env.CRAFT_TOKEN;
const CRAFT_API = 'https://www.craft.do/api/v1';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================
const craftTools = [
  {
    name: 'craft_get_document',
    description: 'Get a Craft document by ID',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'Document ID' },
        format: { type: 'string', description: 'Format: json or markdown (default: markdown)' }
      },
      required: ['docId']
    }
  },
  {
    name: 'craft_search',
    description: 'Search Craft documents',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'craft_add_block',
    description: 'Add content to a Craft document',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'Document ID to add to' },
        markdown: { type: 'string', description: 'Markdown content to add' },
        position: { type: 'string', description: 'start or end (default: end)' }
      },
      required: ['docId', 'markdown']
    }
  }
];

// =============================================================================
// HANDLERS
// =============================================================================
async function craftRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${CRAFT_TOKEN}`,
      'Content-Type': 'application/json',
      'x-craft-space-id': CRAFT_SPACE_ID
    }
  };
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(`${CRAFT_API}${endpoint}`, options);
  if (!response.ok) throw new Error(`Craft API error: ${response.status}`);
  return response.json();
}

async function handleCraftTool(name, args) {
  switch (name) {
    case 'craft_get_document':
      const doc = await craftRequest(`/blocks/${args.docId}?format=${args.format || 'markdown'}`);
      return { content: [{ type: 'text', text: JSON.stringify(doc) }] };
    
    case 'craft_search':
      const results = await craftRequest(`/search?q=${encodeURIComponent(args.query)}`);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    
    case 'craft_add_block':
      const addResult = await craftRequest(`/blocks`, 'POST', {
        position: {
          pageId: args.docId,
          position: args.position || 'end'
        },
        blocks: [{ type: 'text', markdown: args.markdown }]
      });
      return { content: [{ type: 'text', text: JSON.stringify(addResult) }] };
    
    default:
      return null;
  }
}

module.exports = { craftTools, handleCraftTool };
