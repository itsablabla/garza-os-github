#!/bin/bash
# Discover drift between DEPLOYED.yml and actual infrastructure
# Finds things running that aren't documented, and vice versa

set -e

REPO_PATH="/Users/customer/garza-os-github"
DEPLOYED="$REPO_PATH/DEPLOYED.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Infrastructure Drift Detection"
echo "=================================="
echo ""

# Fly.io Apps
echo "📦 Fly.io Apps"
echo "--------------"

# Get actual apps
ACTUAL_FLY=$(flyctl apps list --json 2>/dev/null | jq -r '.[].Name' | sort)

# Get documented apps
DOCUMENTED_FLY=$(grep -A 1 "^  [a-z].*:$" "$DEPLOYED" 2>/dev/null | grep -v "^--$" | grep "^  [a-z]" | sed 's/://g' | sed 's/^ *//' | sort || echo "")

echo "Actual (flyctl apps list):"
echo "$ACTUAL_FLY" | sed 's/^/  /'
echo ""

echo "Documented (DEPLOYED.yml fly_apps):"
echo "$DOCUMENTED_FLY" | sed 's/^/  /'
echo ""

# Find differences
echo "Drift:"
UNDOCUMENTED=$(comm -23 <(echo "$ACTUAL_FLY") <(echo "$DOCUMENTED_FLY"))
MISSING=$(comm -13 <(echo "$ACTUAL_FLY") <(echo "$DOCUMENTED_FLY"))

if [ -n "$UNDOCUMENTED" ]; then
    echo -e "${YELLOW}  Running but not documented:${NC}"
    echo "$UNDOCUMENTED" | sed 's/^/    ⚠️  /'
fi

if [ -n "$MISSING" ]; then
    echo -e "${RED}  Documented but not running:${NC}"
    echo "$MISSING" | sed 's/^/    ❌  /'
fi

if [ -z "$UNDOCUMENTED" ] && [ -z "$MISSING" ]; then
    echo -e "${GREEN}  ✓ No drift detected${NC}"
fi

echo ""

# Cloudflare Workers (requires wrangler)
echo "⚡ Cloudflare Workers"
echo "--------------------"
echo "  Run 'wrangler deployments list' manually to check"
echo ""

# MCP Server Health
echo "🔌 MCP Server Reachability"
echo "--------------------------"

check_mcp() {
    local name=$1
    local url=$2
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    
    if [ "$STATUS" = "200" ]; then
        echo -e "  ${GREEN}✓${NC} $name"
    else
        echo -e "  ${RED}✗${NC} $name ($STATUS)"
    fi
}

check_mcp "cf-mcp" "https://mcp-cf.garzahive.com/health"
check_mcp "garza-home-mcp" "https://garza-home-mcp.fly.dev/health"
check_mcp "n8n-mcp" "https://n8n-mcp.garzahive.com/health"
check_mcp "lrlab-mcp" "https://lrlab-mcp.fly.dev/health"

echo ""
echo "=================================="
echo "Run this periodically to catch drift early."
