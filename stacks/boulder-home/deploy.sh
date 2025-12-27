#!/bin/bash
# GARZA Home Stack - Full Deployment
# Usage: ./deploy.sh <location-name> <admin-password> [timezone]
# This is the ONLY script needed to deploy a new location

set -e

LOCATION="${1:-Garza Boulder}"
PASSWORD="${2}"
TIMEZONE="${3:-America/Denver}"

if [ -z "$PASSWORD" ]; then
    echo "Usage: ./deploy.sh <location-name> <admin-password> [timezone]"
    echo "Example: ./deploy.sh 'Garza Austin' 'SecurePass123!' 'America/Chicago'"
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║         GARZA Home Stack - Full Deployment            ║"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  Location: $(printf '%-40s' "$LOCATION")║"
echo "║  Timezone: $(printf '%-40s' "$TIMEZONE")║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Update configuration
echo "[1/5] Configuring for location..."
sed -i '' "s/name: .*/name: \"$LOCATION\"/" config/configuration.yaml 2>/dev/null || \
sed -i "s/name: .*/name: \"$LOCATION\"/" config/configuration.yaml
sed -i '' "s|time_zone: .*|time_zone: $TIMEZONE|" config/configuration.yaml 2>/dev/null || \
sed -i "s|time_zone: .*|time_zone: $TIMEZONE|" config/configuration.yaml

# Ensure clean state
echo "[2/5] Preparing containers..."
docker compose down 2>/dev/null || true
rm -rf config/.storage config/home-assistant_v2.db* 2>/dev/null || true

# Pull latest images
echo "[3/5] Pulling images..."
docker compose pull

# Start stack
echo "[4/5] Starting stack..."
docker compose up -d

# Wait for HA
echo "[5/5] Waiting for Home Assistant to initialize..."
sleep 15

# Run bootstrap
./bootstrap.sh "$LOCATION" "$PASSWORD" "$TIMEZONE"

echo ""
echo "Stack deployed and configured!"
echo "Access locally: http://localhost:8123"
echo "Access remotely: https://ha.garzahive.com (if tunnel configured)"
