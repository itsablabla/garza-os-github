#!/bin/bash
# Secret Rotation Script for GARZA OS
# Generates new API keys and updates all services

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Generate secure random key
generate_key() {
  openssl rand -hex 32
}

# Apps that need API keys
FLY_APPS=(
  "garza-home-mcp"
  "lrlab-mcp"
  "garza-ears"
  "beeper-matrix-mcp"
)

CF_WORKERS=(
  "garza-log-aggregator"
  "garza-mcp"
  "jessica-cron"
)

echo -e "${BLUE}GARZA OS Secret Rotation${NC}"
echo ""

# Check for dry-run flag
DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo -e "${YELLOW}DRY RUN MODE - No changes will be made${NC}"
  echo ""
fi

# Generate new keys
echo -e "${BLUE}Generating new keys...${NC}"
NEW_API_KEY=$(generate_key)
NEW_MCP_KEY=$(generate_key)
NEW_WEBHOOK_SECRET=$(generate_key)

echo "  API_KEY: ${NEW_API_KEY:0:8}..."
echo "  MCP_KEY: ${NEW_MCP_KEY:0:8}..."
echo "  WEBHOOK_SECRET: ${NEW_WEBHOOK_SECRET:0:8}..."
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}Would update the following:${NC}"
  echo ""
  
  echo "Fly.io Apps:"
  for app in "${FLY_APPS[@]}"; do
    echo "  - $app: API_KEY"
  done
  echo ""
  
  echo "Cloudflare Workers:"
  for worker in "${CF_WORKERS[@]}"; do
    echo "  - $worker: API_KEY"
  done
  echo ""
  
  echo -e "${YELLOW}Run without --dry-run to apply changes${NC}"
  exit 0
fi

# Confirm before proceeding
echo -e "${YELLOW}This will rotate secrets for all services.${NC}"
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Update Fly.io apps
echo ""
echo -e "${BLUE}Updating Fly.io apps...${NC}"
for app in "${FLY_APPS[@]}"; do
  echo -n "  $app... "
  if flyctl secrets set API_KEY="$NEW_API_KEY" -a "$app" --stage 2>/dev/null; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${RED}✗${NC}"
  fi
done

# Deploy staged secrets
echo ""
echo -e "${BLUE}Deploying Fly.io secrets...${NC}"
for app in "${FLY_APPS[@]}"; do
  echo -n "  $app... "
  if flyctl secrets deploy -a "$app" 2>/dev/null; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${YELLOW}(no staged secrets)${NC}"
  fi
done

# Update Cloudflare Workers
echo ""
echo -e "${BLUE}Updating Cloudflare Workers...${NC}"
for worker in "${CF_WORKERS[@]}"; do
  echo -n "  $worker... "
  if wrangler secret put API_KEY --name "$worker" <<< "$NEW_API_KEY" 2>/dev/null; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${RED}✗${NC}"
  fi
done

# Save to local reference (encrypted would be better)
echo ""
echo -e "${BLUE}Saving key reference...${NC}"
KEYS_FILE="$HOME/.garza-keys-$(date +%Y%m%d)"
cat > "$KEYS_FILE" << EOF
# GARZA OS Keys - Generated $(date)
# DELETE THIS FILE AFTER UPDATING CRAFT DOC 7061

API_KEY=$NEW_API_KEY
MCP_KEY=$NEW_MCP_KEY
WEBHOOK_SECRET=$NEW_WEBHOOK_SECRET
EOF
chmod 600 "$KEYS_FILE"
echo "  Saved to: $KEYS_FILE"

echo ""
echo -e "${GREEN}✅ Secret rotation complete!${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT: Update Craft doc 7061 with new keys, then delete $KEYS_FILE${NC}"
