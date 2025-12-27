#!/bin/bash
# GARZA OS Health Check
# Run before any session to verify stack is up

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🏥 GARZA OS Health Check"
echo "========================"
echo ""

FAILED=0
RESULTS=""

check_endpoint() {
    local name=$1
    local url=$2
    local expected=${3:-200}
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    
    if [ "$STATUS" = "$expected" ]; then
        echo -e "${GREEN}✓${NC} $name ($STATUS)"
        RESULTS="$RESULTS\n  $name: UP"
    else
        echo -e "${RED}✗${NC} $name (got $STATUS, expected $expected)"
        RESULTS="$RESULTS\n  $name: DOWN ($STATUS)"
        FAILED=$((FAILED + 1))
    fi
}

check_fly_app() {
    local name=$1
    local url=$2
    
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ] || [ "$STATUS" = "404" ]; then
        echo -e "${GREEN}✓${NC} $name (responding)"
        RESULTS="$RESULTS\n  $name: UP"
    else
        echo -e "${RED}✗${NC} $name ($STATUS)"
        RESULTS="$RESULTS\n  $name: DOWN"
        FAILED=$((FAILED + 1))
    fi
}

echo "📡 Fly.io Apps"
echo "--------------"
check_fly_app "garza-home-mcp" "https://garza-home-mcp.fly.dev/health"
check_fly_app "lrlab-mcp" "https://lrlab-mcp.fly.dev/health"
check_fly_app "garza-ears" "https://garza-ears.fly.dev"
check_fly_app "stagehand-mcp" "https://stagehand-mcp.fly.dev"
check_fly_app "garza-n8n" "https://garza-n8n.fly.dev"
echo ""

echo "⚡ Cloudflare Workers"
echo "--------------------"
check_endpoint "garza-mcp" "https://garza-mcp.garzahive.workers.dev"
check_endpoint "mcp-gateway" "https://mcp-gateway.garzahive.workers.dev"
check_endpoint "garza-health-monitor" "https://garza-health-monitor.garzahive.workers.dev"
echo ""

echo "🔌 MCP Servers (SSE)"
echo "--------------------"
# SSE endpoints return 200 on GET
check_endpoint "cf-mcp" "https://mcp-cf.garzahive.com/health" 
check_endpoint "garza-home-mcp" "https://garza-home-mcp.fly.dev/health"
check_endpoint "n8n-mcp" "https://n8n-mcp.garzahive.com/health"
echo ""

echo "🗄️ External Services"
echo "--------------------"
check_endpoint "n8n-cloud" "https://jadengarza.app.n8n.cloud/healthz"
check_endpoint "supabase" "https://xyzcompanyurl.supabase.co/rest/v1/" "401"
echo ""

echo "🏠 Local Services (via tunnel)"
echo "------------------------------"
# These go through CF tunnel
check_endpoint "beeper-rest" "http://localhost:8765/health" || echo -e "${YELLOW}⚠${NC} Beeper REST (local only)"
echo ""

echo "========================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All systems operational${NC}"
else
    echo -e "${RED}$FAILED service(s) down${NC}"
fi

# Update DEPLOYED.yml timestamp
REPO_PATH="/Users/customer/garza-os-github"
if [ -f "$REPO_PATH/DEPLOYED.yml" ]; then
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    sed -i '' "s/last_health_check:.*/last_health_check: \"$TIMESTAMP\"/" "$REPO_PATH/DEPLOYED.yml"
    echo ""
    echo "Updated DEPLOYED.yml: last_health_check: $TIMESTAMP"
fi

exit $FAILED
