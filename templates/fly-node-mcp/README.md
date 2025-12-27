# Building New MCP Servers

## Quick Start

```bash
# 1. Copy template
cp -r templates/fly-node-mcp my-new-mcp
cd my-new-mcp

# 2. Customize
# - Edit server.js: add tools in getToolDefinitions() and handleToolCall()
# - Update fly.toml: change app name
# - Update package.json: change name

# 3. Deploy
../scripts/deploy-fly.sh my-new-mcp dfw

# 4. Set secrets
flyctl secrets set API_KEY=generate-a-secure-key -a my-new-mcp

# 5. (Optional) Add custom domain
../scripts/add-domain.sh my-new garzahive.com
```

## MCP Tool Definition Pattern

```javascript
// In getToolDefinitions()
{
  name: 'do_something',
  description: 'What this tool does',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'First param' },
      param2: { type: 'number', description: 'Optional param' }
    },
    required: ['param1']
  }
}

// In handleToolCall()
case 'do_something':
  const result = await doSomething(args.param1, args.param2);
  return { 
    content: [{ 
      type: 'text', 
      text: JSON.stringify(result) 
    }] 
  };
```

## Checklist

- [ ] Copy template
- [ ] Add tool definitions
- [ ] Add tool handlers
- [ ] Update app name in fly.toml
- [ ] Deploy to Fly.io
- [ ] Set API_KEY secret
- [ ] Test /health endpoint
- [ ] Test SSE connection
- [ ] Add to Claude.ai MCP connectors
- [ ] Update mcp-routing.md
- [ ] Commit to GitHub

## Adding to Claude.ai

MCP URL format:
```
https://your-app.fly.dev/sse?key=your-api-key
```

Or with custom domain:
```
https://your-subdomain.garzahive.com/sse?key=your-api-key
```
