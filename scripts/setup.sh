#!/bin/bash
# GARZA OS Setup Script
# Run this after cloning the repo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}GARZA OS Setup${NC}"
echo ""

# Make scripts executable
echo -n "Making scripts executable... "
chmod +x "$SCRIPT_DIR"/*.sh
chmod +x "$SCRIPT_DIR/garza"
echo -e "${GREEN}✓${NC}"

# Install CLI to PATH
echo -n "Installing garza CLI... "
if [ -d "$HOME/.local/bin" ]; then
  ln -sf "$SCRIPT_DIR/garza" "$HOME/.local/bin/garza"
  echo -e "${GREEN}✓${NC} (installed to ~/.local/bin)"
elif [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
  ln -sf "$SCRIPT_DIR/garza" "/usr/local/bin/garza"
  echo -e "${GREEN}✓${NC} (installed to /usr/local/bin)"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$SCRIPT_DIR/garza" "$HOME/.local/bin/garza"
  echo -e "${YELLOW}✓${NC} (installed to ~/.local/bin - add to PATH)"
  echo -e "  ${YELLOW}Add this to your shell profile:${NC}"
  echo '  export PATH="$HOME/.local/bin:$PATH"'
fi

# Check dependencies
echo ""
echo -e "${BLUE}Checking dependencies...${NC}"

check_dep() {
  if command -v "$1" &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} $1"
    return 0
  else
    echo -e "  ${RED}✗${NC} $1 (not installed)"
    return 1
  fi
}

MISSING=0
check_dep "flyctl" || MISSING=1
check_dep "wrangler" || MISSING=1
check_dep "git" || MISSING=1
check_dep "curl" || MISSING=1
check_dep "jq" || MISSING=1

if [ $MISSING -eq 1 ]; then
  echo ""
  echo -e "${YELLOW}Some dependencies are missing. Install them:${NC}"
  echo "  brew install flyctl wrangler jq"
  echo "  # or"
  echo "  curl -L https://fly.io/install.sh | sh"
  echo "  npm install -g wrangler"
fi

# Check Fly auth
echo ""
echo -n "Checking Fly.io auth... "
if flyctl auth whoami &> /dev/null; then
  echo -e "${GREEN}✓${NC}"
else
  echo -e "${YELLOW}not logged in${NC}"
  echo "  Run: flyctl auth login"
fi

# Check Cloudflare auth
echo -n "Checking Cloudflare auth... "
if wrangler whoami &> /dev/null; then
  echo -e "${GREEN}✓${NC}"
else
  echo -e "${YELLOW}not logged in${NC}"
  echo "  Run: wrangler login"
fi

# Create directories
echo ""
echo -n "Creating backup directories... "
mkdir -p "$REPO_DIR/backups/craft"
mkdir -p "$REPO_DIR/backups/logs"
echo -e "${GREEN}✓${NC}"

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run 'garza health' to check all services"
echo "  2. Run 'garza status' to see app list"
echo "  3. Run 'garza --help' for all commands"
