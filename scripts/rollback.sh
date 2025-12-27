#!/bin/bash
# rollback.sh - Rollback a Fly.io app to previous version
# Usage: ./rollback.sh <app-name> [version]

APP_NAME=${1:-""}
VERSION=${2:-""}

if [ -z "$APP_NAME" ]; then
  echo "Usage: ./rollback.sh <app-name> [version]"
  echo ""
  echo "Examples:"
  echo "  ./rollback.sh garza-home-mcp          # Rollback to previous version"
  echo "  ./rollback.sh garza-home-mcp 5        # Rollback to version 5"
  exit 1
fi

echo "🔄 Rolling back $APP_NAME..."

# Check auth
if ! flyctl auth whoami &> /dev/null; then
  echo "❌ Not authenticated. Run: flyctl auth login"
  exit 1
fi

# List recent releases
echo ""
echo "Recent releases:"
flyctl releases -a "$APP_NAME" | head -10

if [ -z "$VERSION" ]; then
  # Get previous version
  VERSION=$(flyctl releases -a "$APP_NAME" --json | jq -r '.[1].Version')
  echo ""
  echo "Rolling back to version $VERSION..."
fi

# Confirm
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled"
  exit 0
fi

# Rollback
flyctl deploy --image "registry.fly.io/$APP_NAME:v$VERSION" -a "$APP_NAME"

echo ""
echo "✅ Rolled back to version $VERSION"
flyctl status -a "$APP_NAME"
