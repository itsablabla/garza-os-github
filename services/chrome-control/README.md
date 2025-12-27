# Chrome Control Remote MCP

A hybrid architecture that lets you control Chrome on your Mac from anywhere via Claude.

## Architecture

```
┌─────────────────┐     MCP/HTTP      ┌──────────────────────┐
│  Claude (any)   │ ◄──────────────► │  Cloudflare Worker   │
└─────────────────┘                   │  (MCP Server)        │
                                      └──────────┬───────────┘
                                                 │ WebSocket
                                      ┌──────────▼───────────┐
                                      │  Local Agent (Mac)   │
                                      │  (AppleScript exec)  │
                                      └──────────────────────┘
```

## Setup

### 1. Deploy the Cloudflare Worker

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler deploy
```

Note your worker URL (e.g., `chrome-control-mcp.your-subdomain.workers.dev`)

### 2. Configure and run the Local Agent

```bash
cd agent
npm install

# Set your worker URL
export WORKER_URL="wss://chrome-control-mcp.YOUR_SUBDOMAIN.workers.dev/agent"

npm start
```

### 3. Add to Claude as Remote MCP

In Claude settings, add this as a remote MCP server:
- URL: `https://chrome-control-mcp.YOUR_SUBDOMAIN.workers.dev/mcp`
- Type: HTTP

## Usage

Once connected, Claude can:
- Open URLs in Chrome
- List/switch/close tabs
- Execute JavaScript
- Get page content
- Navigate back/forward

## Running Agent at Startup (optional)

Create a LaunchAgent plist to auto-start:

```bash
cat > ~/Library/LaunchAgents/com.chrome-control.agent.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.chrome-control.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/customer/Projects/chrome-control-remote/agent/index.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>WORKER_URL</key>
        <string>wss://chrome-control-mcp.YOUR_SUBDOMAIN.workers.dev/agent</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.chrome-control.agent.plist
```
