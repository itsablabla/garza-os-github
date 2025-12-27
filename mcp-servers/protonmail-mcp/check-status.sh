#!/bin/bash

echo "🔍 ProtonMail MCP Setup Status"
echo "=============================="
echo ""

# Check Python
if [ -f "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12" ]; then
    echo "✅ Python 3.12: INSTALLED"
else
    echo "⏳ Python 3.12: WAITING (installer should be open)"
fi

# Check venv
if [ -d ~/protonmail-mcp/venv ]; then
    echo "✅ Virtual Environment: CREATED"
else
    echo "⏳ Virtual Environment: PENDING"
fi

# Check MCP install
if [ -f ~/protonmail-mcp/venv/bin/python ]; then
    MCP_INSTALLED=""
    if [ -n "" ]; then
        echo "✅ MCP Library: INSTALLED"
    else
        echo "⏳ MCP Library: PENDING"
    fi
else
    echo "⏳ MCP Library: PENDING"
fi

# Check password
PWD_SET="configured"
if [ "" = "configured" ]; then
    echo "✅ Bridge Password: CONFIGURED"
else
    echo "⚠️  Bridge Password: NEEDS MANUAL SETUP"
    echo "   Run: ~/protonmail-mcp/set-password.sh"
fi

# Check Claude config
if [ -f "/Library/Application Support/Claude/claude_desktop_config.json" ]; then
    HAS_PM="no"
    if [ "" = "yes" ]; then
        echo "✅ Claude Desktop: CONFIGURED"
    else
        echo "⏳ Claude Desktop: PENDING"
    fi
else
    echo "⏳ Claude Desktop: PENDING"
fi

# Check if Bridge is running
if pgrep -x "Proton Mail Bridge" > /dev/null; then
    echo "✅ Proton Mail Bridge: RUNNING"
else
    echo "⚠️  Proton Mail Bridge: NOT RUNNING"
    echo "   Run: open -a 'Proton Mail Bridge'"
fi

echo ""
echo "📊 Auto-Setup Log:"
echo "------------------"
tail -5 ~/protonmail-mcp/auto-setup.log 2>/dev/null || echo "No log yet"

echo ""
echo "🎯 Next Steps:"
if [ ! -f "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12" ]; then
    echo "1. Complete Python installer"
elif [ "" != "configured" ]; then
    echo "1. Run: ~/protonmail-mcp/set-password.sh"
    echo "2. Restart Claude Desktop"
else
    echo "1. Restart Claude Desktop (Cmd+Q then reopen)"
    echo "2. Test: 'Search my ProtonMail for recent emails'"
fi
