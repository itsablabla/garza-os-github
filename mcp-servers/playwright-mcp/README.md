# Playwright MCP Server

Microsoft's official Playwright MCP server deployed to Fly.io.

## Endpoint
```
https://stagehand-mcp.fly.dev/sse
```

## Features
- Headless Chromium browser automation
- Full Playwright API via MCP tools
- SSE transport for remote connections

## MCP Client Config
```json
{
  "mcpServers": {
    "playwright": {
      "url": "https://stagehand-mcp.fly.dev/sse"
    }
  }
}
```

## Available Tools
- `browser_navigate` - Navigate to URL
- `browser_click` - Click elements
- `browser_type` - Type text
- `browser_snapshot` - Get page snapshot
- `browser_screenshot` - Take screenshot
- And more...

## Deploy
```bash
fly deploy --app stagehand-mcp
```

## Based On
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- Docker image: `mcr.microsoft.com/playwright/mcp`
