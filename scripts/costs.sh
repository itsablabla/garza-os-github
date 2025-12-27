#!/bin/bash
# GARZA OS Cost Dashboard
# Shows estimated costs across all platforms

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}GARZA OS Cost Dashboard${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Fly.io
echo -e "${BLUE}Fly.io Apps${NC}"
echo ""

if command -v flyctl &> /dev/null; then
  echo "App                      | Machines | Memory | Status"
  echo "-------------------------|----------|--------|--------"
  
  flyctl apps list --json 2>/dev/null | jq -r '.[] | select(.Status == "deployed") | "\(.Name) | \(.MachineCount // "?") | - | \(.Status)"' 2>/dev/null || echo "(Could not fetch Fly apps)"
  
  echo ""
  echo -e "${YELLOW}Estimated Fly.io costs:${NC}"
  echo "  Shared CPU (256MB): ~\$1.94/mo each"
  echo "  Shared CPU (512MB): ~\$3.19/mo each"
  echo "  Shared CPU (1GB):   ~\$5.70/mo each"
  echo ""
  
  # Count apps
  APP_COUNT=$(flyctl apps list --json 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
  echo "  Active apps: $APP_COUNT"
  echo "  Est. total: ~\$${APP_COUNT:-0} x \$3 = \$$(( ${APP_COUNT:-0} * 3 ))/mo"
else
  echo "(flyctl not installed)"
fi

echo ""

# Cloudflare
echo -e "${BLUE}Cloudflare Workers${NC}"
echo ""

if command -v wrangler &> /dev/null; then
  echo "Workers (free tier includes 100k requests/day):"
  
  # List workers
  wrangler deployments list 2>/dev/null | head -20 || echo "(Could not list deployments)"
  
  echo ""
  echo -e "${YELLOW}Cloudflare resources:${NC}"
  echo "  Workers: Free tier (100k req/day)"
  echo "  D1: Free tier (5GB storage)"
  echo "  KV: Free tier (100k reads/day)"
  echo "  R2: \$0.015/GB stored"
else
  echo "(wrangler not installed)"
fi

echo ""

# DigitalOcean (if doctl installed)
echo -e "${BLUE}DigitalOcean${NC}"
echo ""

if command -v doctl &> /dev/null; then
  echo "Droplets:"
  doctl compute droplet list --format Name,Memory,VCPUs,Disk,Region,Status 2>/dev/null || echo "(Could not fetch)"
  
  echo ""
  echo -e "${YELLOW}Estimated DO costs:${NC}"
  echo "  Basic droplet (1GB): \$6/mo"
  echo "  Basic droplet (2GB): \$12/mo"
else
  echo "(doctl not installed - GarzaHive runs on DO)"
  echo "  Estimated: \$12/mo for 2GB droplet"
fi

echo ""

# Summary
echo -e "${BLUE}Monthly Cost Summary${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Fly.io:        ~\$25-40/mo (8 apps)"
echo "  Cloudflare:    ~\$0 (free tier)"
echo "  DigitalOcean:  ~\$12/mo (GarzaHive)"
echo "  Domains:       ~\$2/mo (prorated)"
echo "  ─────────────────────────"
echo -e "  ${GREEN}Total:         ~\$40-55/mo${NC}"
echo ""
echo "Note: Costs are estimates. Check actual billing for accuracy."
