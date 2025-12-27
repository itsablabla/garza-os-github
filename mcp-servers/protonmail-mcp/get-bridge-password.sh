#!/bin/bash
# Get Bridge Password and Complete Setup

echo "🔑 ProtonMail Bridge Password Setup"
echo "===================================="
echo ""
echo "📱 Getting Bridge password..."
echo ""
echo "STEPS:"
echo "1. Look for ProtonMail Bridge icon in your menu bar (top right)"
echo "2. Click it"
echo "3. Click 'Settings' (gear icon)"
echo "4. Click 'jadengarza@pm.me'"
echo "5. Click 'Mailbox configuration'"
echo "6. You'll see IMAP settings with a password - COPY IT"
echo ""
read -p "Paste Bridge password here: " BRIDGE_PWD

if [ -z "" ]; then
    echo "❌ No password entered. Exiting."
    exit 1
fi

# Update server.py
echo ""
echo "📝 Configuring server with password..."
cd ~/protonmail-mcp
sed -i '' "s/BRIDGE_PASSWORD = \\/BRIDGE_PASSWORD = \\/g" server.py

# Update Claude Desktop config
echo "⚙️  Updating Claude Desktop config..."
CONFIG_FILE="/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "."

if [ ! -f "" ]; then
    echo '{"mcpServers":{}}' > ""
fi

python3 << PYTHON
import json
import os

config_file = os.path.expanduser("")

with open(config_file, "r") as f:
    config = json.load(f)

if "mcpServers" not in config:
    config["mcpServers"] = {}

config["mcpServers"]["protonmail"] = {
    "command": os.path.expanduser("~/protonmail-mcp/venv/bin/python"),
    "args": ["server.py"],
    "cwd": os.path.expanduser("~/protonmail-mcp")
}

with open(config_file, "w") as f:
    json.dump(config, f, indent=2)

print("✅ Claude Desktop configured!")
PYTHON

echo ""
echo "🎉 COMPLETE! ProtonMail MCP is ready!"
echo "====================================="
echo ""
echo "🔄 RESTART CLAUDE:"
echo "   1. Quit Claude Desktop (Cmd+Q)"
echo "   2. Reopen Claude Desktop"
echo "   3. Test: 'Search my ProtonMail for emails from Eric'"
echo ""
echo "📧 AVAILABLE TOOLS:"
echo "   • search_protonmail - Search emails"
echo "   • read_protonmail - Read full email"
echo "   • send_protonmail - Send emails"
echo ""
