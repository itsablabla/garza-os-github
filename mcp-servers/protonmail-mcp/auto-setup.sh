#!/bin/bash
# Auto-run setup when Python 3.12 is ready

echo "👀 Watching for Python 3.12 installation..."

while [ ! -f "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12" ]; do
    sleep 3
done

echo "✅ Python 3.12 detected! Starting automated setup..."
sleep 2

cd ~/protonmail-mcp

# Create venv
echo "📦 Creating virtual environment..."
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 -m venv venv

# Install MCP
echo "📥 Installing MCP library..."
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q mcp

echo ""
echo "✅ AUTOMATED SETUP COMPLETE!"
echo ""
echo "🔑 NEXT: Get Bridge Password"
echo "   Run: ~/protonmail-mcp/get-bridge-password.sh"
echo ""
