#!/bin/bash
# Quick deploy script - deploy everything or specific apps

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

deploy_fly_app() {
  local app_dir=$1
  local app_name=$(basename "$app_dir")
  
  if [ ! -f "$app_dir/fly.toml" ]; then
    echo -e "  ${YELLOW}⏭ $app_name (no fly.toml)${NC}"
    return
  fi
  
  echo -n "  Deploying $app_name... "
  if cd "$app_dir" && flyctl deploy --remote-only 2>&1 | tail -1; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${RED}✗${NC}"
  fi
}

deploy_cf_worker() {
  local worker_dir=$1
  local worker_name=$(basename "$worker_dir")
  
  if [ ! -f "$worker_dir/wrangler.toml" ]; then
    echo -e "  ${YELLOW}⏭ $worker_name (no wrangler.toml)${NC}"
    return
  fi
  
  echo -n "  Deploying $worker_name... "
  if cd "$worker_dir" && wrangler deploy 2>&1 | tail -1; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${RED}✗${NC}"
  fi
}

case "$1" in
  fly|mcp)
    echo -e "${BLUE}Deploying Fly.io MCP servers...${NC}"
    for dir in "$REPO_DIR"/mcp-servers/*/; do
      deploy_fly_app "$dir"
    done
    ;;
  
  services)
    echo -e "${BLUE}Deploying Fly.io services...${NC}"
    for dir in "$REPO_DIR"/services/*/; do
      deploy_fly_app "$dir"
    done
    ;;
  
  workers|cf)
    echo -e "${BLUE}Deploying Cloudflare Workers...${NC}"
    for dir in "$REPO_DIR"/workers/*/; do
      deploy_cf_worker "$dir"
    done
    ;;
  
  all)
    echo -e "${BLUE}Deploying ALL services...${NC}"
    echo ""
    
    echo "MCP Servers:"
    for dir in "$REPO_DIR"/mcp-servers/*/; do
      deploy_fly_app "$dir"
    done
    
    echo ""
    echo "Services:"
    for dir in "$REPO_DIR"/services/*/; do
      deploy_fly_app "$dir"
    done
    
    echo ""
    echo "Cloudflare Workers:"
    for dir in "$REPO_DIR"/workers/*/; do
      deploy_cf_worker "$dir"
    done
    ;;
  
  *)
    # Deploy specific app by name
    if [ -n "$1" ]; then
      FOUND=false
      
      for base in mcp-servers services workers; do
        if [ -d "$REPO_DIR/$base/$1" ]; then
          FOUND=true
          if [ "$base" = "workers" ]; then
            echo -e "${BLUE}Deploying worker: $1${NC}"
            deploy_cf_worker "$REPO_DIR/$base/$1"
          else
            echo -e "${BLUE}Deploying: $1${NC}"
            deploy_fly_app "$REPO_DIR/$base/$1"
          fi
          break
        fi
      done
      
      if [ "$FOUND" = false ]; then
        echo -e "${RED}Unknown app: $1${NC}"
        exit 1
      fi
    else
      echo "Usage: deploy.sh <target>"
      echo ""
      echo "Targets:"
      echo "  all       - Deploy everything"
      echo "  fly|mcp   - Deploy all MCP servers"
      echo "  services  - Deploy all services"
      echo "  workers   - Deploy all CF workers"
      echo "  <name>    - Deploy specific app by name"
    fi
    ;;
esac

echo ""
echo -e "${GREEN}Done!${NC}"
