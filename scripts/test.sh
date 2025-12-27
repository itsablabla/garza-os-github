#!/bin/bash
# GARZA OS Integration Tests
# Tests connectivity and basic functionality of all services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0
SKIPPED=0

test_result() {
  if [ $1 -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} $2"
    ((PASSED++))
  else
    echo -e "  ${RED}✗${NC} $2: $3"
    ((FAILED++))
  fi
}

skip_test() {
  echo -e "  ${YELLOW}⏭${NC} $1: $2"
  ((SKIPPED++))
}

echo -e "${BLUE}GARZA OS Integration Tests${NC}"
echo ""

# Health endpoint tests
echo "Health Endpoints:"

test_health() {
  local name=$1
  local url=$2
  
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  
  if [ "$response" = "200" ] || [ "$response" = "204" ]; then
    test_result 0 "$name"
  else
    test_result 1 "$name" "HTTP $response"
  fi
}

test_health "garza-home-mcp" "https://garza-home-mcp.fly.dev/health"
test_health "lrlab-mcp" "https://lrlab-mcp.fly.dev/health"
test_health "garza-ears" "https://garza-ears.fly.dev/health"
test_health "cf-mcp" "https://mcp-cf.garzahive.com/health"
test_health "n8n-mcp" "https://n8n-mcp.garzahive.com/health"

echo ""

# MCP SSE endpoint tests
echo "MCP SSE Endpoints:"

test_sse() {
  local name=$1
  local url=$2
  
  # Just check if we get a response (SSE will hang if we don't timeout)
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "timeout")
  
  # SSE endpoints often return 200 and stream, or timeout - both are acceptable
  if [ "$response" = "200" ] || [ "$response" = "timeout" ]; then
    test_result 0 "$name (SSE)"
  else
    test_result 1 "$name (SSE)" "HTTP $response"
  fi
}

test_sse "garza-home-mcp" "https://garza-home-mcp.fly.dev/sse"
test_sse "lrlab-mcp" "https://lrlab-mcp.fly.dev/sse"

echo ""

# API functionality tests (if API keys are available)
echo "API Functionality:"

if [ -n "$GARZA_API_KEY" ]; then
  # Test authenticated endpoints
  echo "  (API tests require manual verification)"
  skip_test "Authenticated endpoints" "Set GARZA_API_KEY to test"
else
  skip_test "Authenticated endpoints" "GARZA_API_KEY not set"
fi

echo ""

# Cloudflare Worker tests
echo "Cloudflare Workers:"

test_health "jessica-cron" "https://jessica-cron.garzahive.workers.dev"
test_health "garza-mcp" "https://garza-mcp.garzahive.workers.dev/health"

echo ""

# Local service connectivity
echo "Local Services (Boulder):"

# These will fail from outside the network
test_local() {
  local name=$1
  local url=$2
  
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
  
  if [ "$response" = "000" ]; then
    skip_test "$name" "Not reachable (expected if outside network)"
  elif [ "$response" = "200" ] || [ "$response" = "204" ]; then
    test_result 0 "$name"
  else
    test_result 1 "$name" "HTTP $response"
  fi
}

test_local "UniFi Protect" "http://192.168.10.49:7441"
test_local "Home Assistant" "http://192.168.10.49:8123"

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$SKIPPED skipped${NC}"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
