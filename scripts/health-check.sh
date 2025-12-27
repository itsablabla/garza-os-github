#!/bin/bash
# health-check.sh - Check all MCP servers
# Usage: ./health-check.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SERVERS=(
  "CF MCP|http://localhost:3333/health"
  "Garza Home|https://garza-home-mcp.fly.dev/health"
  "Garza Hive|https://mcp.garzahive.com/health"
  "LRLab|https://lrlab-mcp.fly.dev/health"
  "Beeper Bridge|http://localhost:8765/health"
)

echo "🏥 MCP Health Check - $(date)"
echo "================================"

ALL_OK=true

for server in "${SERVERS[@]}"; do
  IFS='|' read -r name url <<< "$server"
  
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
  
  if [ "$response" = "200" ]; then
    echo -e "${GREEN}✓${NC} $name"
  else
    echo -e "${RED}✗${NC} $name (HTTP $response)"
    ALL_OK=false
  fi
done

echo "================================"
if $ALL_OK; then
  echo -e "${GREEN}All systems operational${NC}"
  exit 0
else
  echo -e "${RED}Some systems down${NC}"
  exit 1
fi
