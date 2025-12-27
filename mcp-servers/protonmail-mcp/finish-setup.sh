#!/bin/bash
# ProtonMail MCP - Final Setup

echo "🐝 ProtonMail MCP - Final Setup"
echo "================================"
echo ""

# Wait for Python 3.12
echo "⏳ Waiting for Python 3.12 installation..."
while [ ! -f "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12" ]; do
    echo "   Python 3.12 not found yet. Please complete the installer..."
    sleep 5
done
echo "✅ Python 3.12 found!"

# Create venv
echo ""
echo "📦 Creating virtual environment..."
cd ~/protonmail-mcp
rm -rf venv
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 -m venv venv

# Install MCP
echo "📥 Installing MCP library..."
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q mcp

# Get Bridge password
echo ""
echo "🔑 Bridge Password Setup"
echo "========================"
echo ""
echo "📱 OPEN PROTONMAIL BRIDGE APP NOW:"
echo "   1. Click Bridge icon in menu bar"
echo "   2. Click Settings (gear)"  
echo "   3. Click jadengarza@pm.me"
echo "   4. Click 'Mailbox configuration'"
echo "   5. Copy the Bridge password"
echo ""
read -p "Paste Bridge password here: " BRIDGE_PWD

# Update server.py
echo ""
echo "📝 Configuring server..."
sed -i '' "s/BRIDGE_PASSWORD = \\/BRIDGE_PASSWORD = \\/g" server.py

# Update Claude config
echo "⚙️  Updating Claude Desktop..."
CONFIG_FILE="/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "."

if [ ! -f "" ]; then
    echo '{"mcpServers":{}}' > ""
fi

/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 << PYTHON
import json

with open("", "r") as f:
    config = json.load(f)

if "mcpServers" not in config:
    config["mcpServers"] = {}

config["mcpServers"]["protonmail"] = {
    "command": "/protonmail-mcp/venv/bin/python",
    "args": ["server.py"],
    "cwd": "/protonmail-mcp"
}

with open("", "w") as f:
    json.dump(config, f, indent=2)
PYTHON

echo ""
echo "🎉 SETUP COMPLETE!"
echo "=================="
echo ""
echo "✅ ProtonMail MCP installed"
echo "✅ Claude Desktop configured"
echo ""
echo "🔄 FINAL STEP:"
echo "   1. Quit Claude Desktop (Cmd+Q)"
echo "   2. Reopen Claude Desktop"
echo "   3. Ask: 'Search my ProtonMail for recent emails'"
echo ""
