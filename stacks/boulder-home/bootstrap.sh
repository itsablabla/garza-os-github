#!/bin/bash
# GARZA Home Stack - Full Automated Bootstrap
# Usage: ./bootstrap.sh <location-name> <admin-password> [timezone]
# Outputs: Long-lived access token for MCP/Claude control

set -e

LOCATION="${1:-Garza Boulder}"
PASSWORD="${2:-$(openssl rand -base64 16)}"
TIMEZONE="${3:-America/Denver}"
HA_URL="http://localhost:8123"

echo "═══════════════════════════════════════════════════════"
echo "  GARZA Home Stack Bootstrap"
echo "  Location: $LOCATION"
echo "  Timezone: $TIMEZONE"
echo "═══════════════════════════════════════════════════════"

# Wait for HA to be ready
echo "[1/6] Waiting for Home Assistant..."
for i in {1..30}; do
    if curl -s "$HA_URL/api/onboarding" | grep -q "user"; then
        echo "      Home Assistant is ready"
        break
    fi
    sleep 2
done

# Check if already onboarded
ONBOARD_STATUS=$(curl -s "$HA_URL/api/onboarding")
if echo "$ONBOARD_STATUS" | grep -q '"done":true'; then
    echo "[!] Already onboarded. Skipping user creation."
    echo "    Use existing credentials or reset the instance."
    exit 1
fi

# Step 1: Create admin user
echo "[2/6] Creating admin user..."
AUTH_CODE=$(curl -s -X POST "$HA_URL/api/onboarding/users" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"$HA_URL/\",\"name\":\"Jaden Garza\",\"username\":\"jaden\",\"password\":\"$PASSWORD\",\"language\":\"en\"}" \
    | jq -r '.auth_code')

if [ -z "$AUTH_CODE" ] || [ "$AUTH_CODE" == "null" ]; then
    echo "[!] Failed to create user"
    exit 1
fi

# Step 2: Get access token
echo "[3/6] Obtaining access token..."
TOKEN_RESPONSE=$(curl -s -X POST "$HA_URL/auth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code&code=$AUTH_CODE&client_id=$HA_URL/")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')
REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token')

# Step 3: Complete core config
echo "[4/6] Configuring core settings..."
curl -s -X POST "$HA_URL/api/onboarding/core_config" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{}" > /dev/null

# Step 4: Skip analytics
echo "[5/6] Completing onboarding..."
curl -s -X POST "$HA_URL/api/onboarding/analytics" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{}" > /dev/null

# Step 5: Create long-lived access token for MCP
echo "[6/6] Creating long-lived access token..."
LLAT_RESPONSE=$(curl -s -X POST "$HA_URL/api/auth/long_lived_access_token" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"client_name\":\"GARZA-OS-MCP\",\"lifespan\":365}")

LONG_LIVED_TOKEN=$(echo "$LLAT_RESPONSE" | jq -r '.')

# Output credentials
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Bootstrap Complete"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "LOCATION: $LOCATION"
echo "URL: $HA_URL"
echo "USERNAME: jaden"
echo "PASSWORD: $PASSWORD"
echo ""
echo "LONG_LIVED_TOKEN (for MCP):"
echo "$LONG_LIVED_TOKEN"
echo ""
echo "═══════════════════════════════════════════════════════"

# Save to local secrets file
cat > .credentials << EOF
# GARZA Home Stack Credentials
# Location: $LOCATION
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

HA_URL=$HA_URL
HA_USERNAME=jaden
HA_PASSWORD=$PASSWORD
HA_LONG_LIVED_TOKEN=$LONG_LIVED_TOKEN
HA_REFRESH_TOKEN=$REFRESH_TOKEN
EOF

chmod 600 .credentials
echo "Credentials saved to .credentials (chmod 600)"
