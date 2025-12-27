# UniFi Protect MCP

Local MCP server for UniFi Protect camera system control.

## Features
- **Cameras**: List, get details, snapshots
- **PTZ**: Pan, tilt, zoom, preset positions
- **Events**: Motion detection, smart detection
- **Sensors**: Door/window, motion sensors
- **Lights**: Smart flood lights control
- **Chimes**: Doorbell chime control
- **Doorbell**: LCD message display

## Deployment
Local (Mac Mini via launchd)

## Configuration
- `unvr_host` - UniFi Protect controller IP
- `server_port` - Local server port (3849)
- `api_key` - Authentication key

## Endpoints
- `GET /health` - Health check
- `POST /sse` - SSE connection for MCP
- `POST /message/:id` - Tool execution

## Auth
Authenticates directly with UniFi Protect controller using local credentials.

## Logging
Logs to `/Users/customer/unifi-protect-mcp/access.log`
