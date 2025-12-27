# Garza Home MCP

Primary home automation MCP server - the main brain of GARZA OS.

## Features
- **Abode Security**: Arm/disarm, device control, automations
- **Beeper Messaging**: Search, send, chat management
- **UniFi Protect**: Cameras, snapshots, events, sensors, lights
- **ProtonMail**: Search, read, send encrypted email
- **Bible API**: Verse lookup, search, verse of the day
- **Graphiti**: Knowledge graph operations

## Deployment
Fly.io (`garza-home-mcp`)

## Environment Variables
See `envs/garza-home-mcp.env.example`

## Files
- `server.mjs` - Main server
- `fly.toml` - Fly.io config
- `Dockerfile` - Container build
- `start.sh` - Startup script

## Endpoints
- `GET /health` - Health check
- `POST /sse` - SSE connection for MCP
- `POST /message/:id` - Tool execution
