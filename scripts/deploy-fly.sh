#!/bin/bash
# deploy-fly.sh - Deploy to Fly.io with standard patterns
# Usage: ./deploy-fly.sh <app-name> [region]

set -e

APP_NAME=${1:-""}
REGION=${2:-"dfw"}  # Dallas default (Denver deprecated)

if [ -z "$APP_NAME" ]; then
  echo "Usage: ./deploy-fly.sh <app-name> [region]"
  echo "Regions: dfw (Dallas), sjc (San Jose), iad (Virginia), lhr (London)"
  exit 1
fi

echo "🚀 Deploying $APP_NAME to $REGION..."

# Check flyctl
if ! command -v flyctl &> /dev/null; then
  echo "Installing flyctl..."
  curl -L https://fly.io/install.sh | sh
  export PATH="$HOME/.fly/bin:$PATH"
fi

# Check auth
if ! flyctl auth whoami &> /dev/null; then
  echo "❌ Not authenticated. Run: flyctl auth login"
  exit 1
fi

# Update fly.toml with app name and region
if [ -f fly.toml ]; then
  sed -i '' "s/^app = .*/app = \"$APP_NAME\"/" fly.toml
  sed -i '' "s/^primary_region = .*/primary_region = \"$REGION\"/" fly.toml
else
  echo "❌ No fly.toml found. Are you in the right directory?"
  exit 1
fi

# Check if app exists, create if not
if ! flyctl apps list | grep -q "$APP_NAME"; then
  echo "Creating app $APP_NAME..."
  flyctl apps create "$APP_NAME" --org personal
fi

# Deploy
echo "Deploying..."
flyctl deploy --ha=false

echo "✅ Deployed! https://$APP_NAME.fly.dev"
echo ""
echo "Next steps:"
echo "  flyctl secrets set API_KEY=your-key -a $APP_NAME"
echo "  flyctl logs -a $APP_NAME"
