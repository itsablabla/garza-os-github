# Claude MCP Manager

Browser automation server for managing Claude.ai sessions via Playwright.

## Features
- Check login status
- Take screenshots
- Navigate Claude.ai interface
- Manage MCP connections

## Deployment
Fly.io (`claude-mcp-manager`)

## Environment Variables
- `CLAUDE_COOKIES` - JSON array of session cookies
- `API_KEY` - Server authentication key

## Endpoints
- `GET /health` - Health check
- `GET /status` - Check login status
- `GET /screenshot` - Capture current page

## Tech Stack
- Express.js
- Playwright (Chromium)
