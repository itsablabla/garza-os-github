# CF MCP v2.0 - Unified Secure MCP Server

## Overview
Unified Model Context Protocol server combining ProtonMail, file operations, and shell commands with API key authentication.

## Features
✅ **ProtonMail Integration** - IMAP search/read, SMTP send
✅ **File Operations** - read, write, list directories  
✅ **Shell Commands** - Execute commands on Mac
✅ **Security** - API key authentication, security headers
✅ **Auto-Start** - LaunchAgent keeps service running

## Server Info
- **URL:** `http://localhost:3333/sse?key=garza-secure-key-2024`
- **API Key:** `garza-secure-key-2024`
- **Version:** 2.0.0
- **Port:** 3333

## Available Tools

### ProtonMail Tools
1. **search_protonmail** - Search inbox using IMAP criteria
   - `criteria`: IMAP search (e.g., "ALL", "FROM eric@example.com", "SUBJECT verizon")
   - `limit`: Max results (default: 10)

2. **read_protonmail** - Read full message by UID
   - `uid`: Message UID from search results

3. **send_protonmail** - Send encrypted email
   - `to`: Recipient email
   - `subject`: Email subject
   - `text`: Plain text body
   - `html`: HTML body (optional)
   - `cc`: CC recipients (optional)
   - `bcc`: BCC recipients (optional)

### File & Shell Tools
4. **execute_command** - Execute shell command
5. **read_file** - Read file contents
6. **write_file** - Write to file
7. **list_directory** - List directory contents

## Security
- **API Key Authentication:** All requests require `?key=garza-secure-key-2024`
- **Security Headers:** X-Content-Type-Options, X-Frame-Options, X-XSS-Protection
- **Health Endpoint:** `/health` (no auth required)

## Service Management

### Start Service
```bash
launchctl load ~/Library/LaunchAgents/com.garza.cf-mcp.plist
```

### Stop Service
```bash
launchctl unload ~/Library/LaunchAgents/com.garza.cf-mcp.plist
```

### Restart Service
```bash
launchctl unload ~/Library/LaunchAgents/com.garza.cf-mcp.plist
launchctl load ~/Library/LaunchAgents/com.garza.cf-mcp.plist
```

### Check Status
```bash
curl http://localhost:3333/health
```

### View Logs
```bash
tail -f ~/mcp-server/stdout.log
tail -f ~/mcp-server/stderr.log
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cf-mcp-secure": {
      "url": "http://localhost:3333/sse?key=garza-secure-key-2024"
    }
  }
}
```

## ProtonMail Bridge Configuration
- **IMAP:** 127.0.0.1:1143
- **SMTP:** 127.0.0.1:1025
- **Email:** jadengarza@pm.me
- **Password:** Stored in server.js

## Files
- **Server:** `~/mcp-server/server.js`
- **LaunchAgent:** `~/Library/LaunchAgents/com.garza.cf-mcp.plist`
- **Logs:** `~/mcp-server/stdout.log`, `~/mcp-server/stderr.log`
- **Config:** `~/Library/Application Support/Claude/claude_desktop_config.json`

## Environment Variables
- `PORT`: Server port (default: 3333)
- `MCP_API_KEY`: Authentication key (default: garza-secure-key-2024)

## Troubleshooting

### Server won't start
```bash
# Check if port is in use
lsof -i:3333

# Kill process using port
lsof -ti:3333 | xargs kill -9

# Restart service
launchctl unload ~/Library/LaunchAgents/com.garza.cf-mcp.plist
launchctl load ~/Library/LaunchAgents/com.garza.cf-mcp.plist
```

### ProtonMail not working
1. Check ProtonMail Bridge is running
2. Verify Bridge password in server.js matches Bridge settings
3. Check logs for connection errors

### Authentication errors
1. Verify API key in URL: `?key=garza-secure-key-2024`
2. Check Claude Desktop config has correct URL with key
3. Restart Claude Desktop after config changes

## Security Notes
- API key is required for all endpoints except `/health`
- Store API key securely (currently in server.js and LaunchAgent plist)
- Consider rotating API key periodically
- Server runs locally (127.0.0.1) - not exposed to internet

## Version History
- **v2.0.0** - Unified server with ProtonMail + security
- **v1.0.0** - Basic file/shell operations

---

**Status:** ✅ Active and running
**Last Updated:** December 24, 2024
