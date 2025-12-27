#!/bin/bash
# GARZA OS Sync Script
# Run this to pull latest server code into the repo

echo "🔄 Syncing GARZA OS servers to repo..."

# CF MCP
echo "  → cf-mcp"
cp /Users/customer/mcp-server/server.js mcp-servers/cf-mcp/
cp /Users/customer/mcp-server/package.json mcp-servers/cf-mcp/

# Garza Home MCP
echo "  → garza-home-mcp"
cp /Users/customer/garza-os-v2/garza-home-mcp/server.mjs mcp-servers/garza-home-mcp/
cp /Users/customer/garza-os-v2/garza-home-mcp/package.json mcp-servers/garza-home-mcp/
cp /Users/customer/garza-os-v2/garza-home-mcp/Dockerfile mcp-servers/garza-home-mcp/
cp /Users/customer/garza-os-v2/garza-home-mcp/fly.toml mcp-servers/garza-home-mcp/

# Garza Cloud MCP
echo "  → garza-cloud-mcp"
cp /Users/customer/garza-cloud-mcp/src/index.ts mcp-servers/garza-cloud-mcp/src/
cp /Users/customer/garza-cloud-mcp/wrangler.toml mcp-servers/garza-cloud-mcp/

# Beeper Matrix MCP
echo "  → beeper-matrix-mcp"
cp /Users/customer/beeper-matrix-mcp/server.js mcp-servers/beeper-matrix-mcp/

# UniFi Protect MCP
echo "  → unifi-protect-mcp"
cp /Users/customer/unifi-protect-mcp/server-v5.4.js mcp-servers/unifi-protect-mcp/server.js

# Show what changed
echo ""
echo "📝 Changes:"
git status --short

echo ""
echo "Run 'git add -A && git commit -m \"message\" && git push' to push changes"
