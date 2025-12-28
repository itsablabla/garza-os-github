#!/bin/bash
set -e

echo "🚀 Starting GARZA Desktop Commander Container..."

# Create workspace
mkdir -p /workspace

# Set up environment
export HOME=/root
export PATH="/root/.fly/bin:$PATH"

# Clone/update garza-os-github repo if not present
if [ ! -d "/workspace/garza-os-github" ]; then
    echo "📦 Cloning garza-os-github..."
    cd /workspace
    git clone https://github.com/itsablabla/garza-os-github.git || echo "Failed to clone"
else
    echo "✅ garza-os-github already present"
fi

cd /workspace

# Start simple HTTP server for health checks
python3 -m http.server 6000 &

# Log instance info
echo "📍 Instance ID: ${FLY_ALLOC_ID:-local}"
echo "📍 Region: ${FLY_REGION:-local}"
echo "📍 App: ${FLY_APP_NAME:-garza-desktop-commander}"
echo "⚠️  Desktop Commander MCP not yet configured - container running in placeholder mode"

# Keep container alive
tail -f /dev/null