#!/bin/bash
# add-domain.sh - Add custom domain to Fly.io app with Cloudflare DNS
# Usage: ./add-domain.sh <subdomain> <app-name>
# Example: ./add-domain.sh my-mcp garza-my-mcp

set -e

SUBDOMAIN=${1:-""}
APP_NAME=${2:-""}
DOMAIN="garzahive.com"
ZONE_ID="9c70206ce57d506d1d4e9397f6bb8ebc"

if [ -z "$SUBDOMAIN" ] || [ -z "$APP_NAME" ]; then
  echo "Usage: ./add-domain.sh <subdomain> <app-name>"
  echo "Example: ./add-domain.sh my-mcp garza-my-mcp"
  exit 1
fi

FULL_DOMAIN="$SUBDOMAIN.$DOMAIN"

echo "🌐 Setting up $FULL_DOMAIN for $APP_NAME..."

# Check for Cloudflare credentials
if [ -z "$CF_API_KEY" ] || [ -z "$CF_EMAIL" ]; then
  echo "❌ Set CF_API_KEY and CF_EMAIL environment variables"
  echo "   export CF_API_KEY=your-global-api-key"
  echo "   export CF_EMAIL=jadengarza@pm.me"
  exit 1
fi

# Create DNS record (A record to Fly.io)
echo "Creating DNS record..."
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"A\",\"name\":\"$SUBDOMAIN\",\"content\":\"66.241.124.34\",\"ttl\":1,\"proxied\":false}" \
  | jq -r '.success'

# Add IPv6 too
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"AAAA\",\"name\":\"$SUBDOMAIN\",\"content\":\"2a09:8280:1::be:5a29:0\",\"ttl\":1,\"proxied\":false}" \
  | jq -r '.success'

# Add cert to Fly
echo "Adding certificate..."
flyctl certs add "$FULL_DOMAIN" -a "$APP_NAME"

# Wait and check
echo "Waiting for cert..."
sleep 10
flyctl certs check "$FULL_DOMAIN" -a "$APP_NAME"

echo ""
echo "✅ Done! Test with: curl https://$FULL_DOMAIN/health"
