#!/bin/bash
# exec-fallback.sh - Execute command with automatic fallback
# Usage: ./exec-fallback.sh "command to run" [target]
# Targets: mac, garzahive, auto (default)

COMMAND="$1"
TARGET="${2:-auto}"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./exec-fallback.sh 'command' [mac|garzahive|auto]"
  exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

try_exec() {
  local method="$1"
  local cmd="$2"
  echo -e "${YELLOW}Trying: $method${NC}"
  
  case "$method" in
    "cf-shell")
      result=$(curl -s -X POST "http://localhost:3333/exec" \
        -H "Content-Type: application/json" \
        -d "{\"command\": \"$cmd\"}" 2>/dev/null)
      ;;
    "cf-ssh-mac")
      result=$(curl -s -X POST "http://localhost:3333/ssh" \
        -H "Content-Type: application/json" \
        -d "{\"host\": \"mac\", \"command\": \"$cmd\"}" 2>/dev/null)
      ;;
    "cf-ssh-garzahive")
      result=$(curl -s -X POST "http://localhost:3333/ssh" \
        -H "Content-Type: application/json" \
        -d "{\"host\": \"garzahive\", \"command\": \"$cmd\"}" 2>/dev/null)
      ;;
    "direct-ssh-mac")
      result=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no customer@45.147.93.59 "$cmd" 2>/dev/null)
      ;;
    "direct-ssh-garzahive")
      result=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@134.122.8.40 "$cmd" 2>/dev/null)
      ;;
  esac
  
  if [ $? -eq 0 ] && [ -n "$result" ]; then
    echo -e "${GREEN}✓ Success via $method${NC}"
    echo "$result"
    return 0
  fi
  return 1
}

# Mac target
if [ "$TARGET" = "mac" ] || [ "$TARGET" = "auto" ]; then
  try_exec "cf-shell" "$COMMAND" && exit 0
  try_exec "cf-ssh-mac" "$COMMAND" && exit 0
  try_exec "direct-ssh-mac" "$COMMAND" && exit 0
fi

# GarzaHive target
if [ "$TARGET" = "garzahive" ] || [ "$TARGET" = "auto" ]; then
  try_exec "cf-ssh-garzahive" "$COMMAND" && exit 0
  try_exec "direct-ssh-garzahive" "$COMMAND" && exit 0
fi

echo -e "${RED}✗ All methods failed${NC}"
exit 1
