# Computer Use MCP

Browser automation MCP server using Puppeteer for web interactions.

## Features
- Take screenshots
- Navigate to URLs
- Click elements
- Type text
- Session management

## Deployment
Local or Fly.io

## Environment Variables
- `API_KEY` - Server authentication key
- `PORT` - Server port

## Sessions
Supports multiple concurrent browser sessions with unique session IDs.

## Tech Stack
- Express.js
- Puppeteer (headless Chrome)

## Tools
- `screenshot` - Capture page as base64 PNG
- `navigate` - Go to URL
- `click` - Click at coordinates
- `type` - Enter text
