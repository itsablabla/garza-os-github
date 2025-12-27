# Runbook: Add New Tool to Existing MCP Server

## Prerequisites
- MCP server already deployed on Fly.io
- Tool function written and tested locally

## Steps

### 1. Locate the server code
```bash
# Check DEPLOYED.yml for repo_path
grep -A 5 "server-name" /Users/customer/garza-os-github/DEPLOYED.yml
```

### 2. Add the tool handler
```typescript
// In src/tools/index.ts or similar
export const newTool = {
  name: "new_tool_name",
  description: "What it does",
  inputSchema: {
    type: "object",
    properties: {
      param1: { type: "string", description: "..." }
    },
    required: ["param1"]
  }
};

// In handler
case "new_tool_name":
  return await handleNewTool(args);
```

### 3. Register in tools list
```typescript
// tools/list response
{
  tools: [
    ...existingTools,
    newTool
  ]
}
```

### 4. Test locally
```bash
cd /path/to/mcp-server
npm run dev

# In another terminal
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "new_tool_name", "arguments": {...}}}'
```

### 5. Deploy
```bash
flyctl deploy -a server-name
```

### 6. Verify
```bash
# Check tool appears in list
curl https://server-name.fly.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```

### 7. Update docs
- Add to DEPLOYED.yml tools list
- Add to relevant credentials/endpoints docs if new auth needed

## Common Issues

| Issue | Fix |
|-------|-----|
| Tool not appearing | Check tools/list handler includes new tool |
| Auth failing | Verify API key in Fly secrets |
| Timeout | Increase timeout in fly.toml or tool handler |
