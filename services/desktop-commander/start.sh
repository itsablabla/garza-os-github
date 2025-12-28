#!/bin/bash
set -e

echo "🚀 Starting GARZA Desktop Commander..."

# Create workspace if it doesn't exist
mkdir -p /workspace

# Set up environment
export HOME=/root
export PATH="/root/.fly/bin:$PATH"

# Clone/update garza-os-github repo if not present
if [ ! -d "/workspace/garza-os-github" ]; then
    echo "📦 Cloning garza-os-github..."
    cd /workspace
    git clone https://github.com/itsablabla/garza-os-github.git || echo "Failed to clone, will try to mount volume"
else
    echo "✅ garza-os-github already present"
fi

# Change to workspace
cd /workspace

# Start simple HTTP server for health checks in background
python3 -m http.server 6000 &

# Log instance info
echo "📍 Instance ID: ${FLY_ALLOC_ID:-local}"
echo "📍 Region: ${FLY_REGION:-local}"
echo "📍 App: ${FLY_APP_NAME:-garza-desktop-commander}"

# Start Desktop Commander MCP Server
echo "🖥️  Starting Desktop Commander MCP Server..."

# Run Desktop Commander in server mode (this blocks)
desktop-commander serve --port 6001

# If we get here, something went wrong
echo "❌ Desktop Commander exited unexpectedly"
exit 1