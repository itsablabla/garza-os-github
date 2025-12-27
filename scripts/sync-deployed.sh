#!/bin/bash
# Sync DEPLOYED.yml with actual running services
# Run periodically or on-demand to catch drift

set -e

REPO_PATH="/Users/customer/garza-os-github"
OUTPUT_FILE="$REPO_PATH/DEPLOYED.yml.new"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "🔄 Syncing DEPLOYED.yml with live infrastructure..."
echo ""

# Start YAML
cat > "$OUTPUT_FILE" << 'HEADER'
# GARZA OS Deployment Manifest
# Auto-generated - do not edit manually
# Run scripts/sync-deployed.sh to update
HEADER

echo "last_sync: \"$TIMESTAMP\"" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Fly.io Apps
echo "📦 Fetching Fly.io apps..."
echo "fly_apps:" >> "$OUTPUT_FILE"

flyctl apps list --json 2>/dev/null | jq -r '.[] | select(.Organization.Slug == "personal") | "  \(.Name):\n    status: \(.Status)\n    hostname: \(.Hostname)"' >> "$OUTPUT_FILE" 2>/dev/null || echo "  # Error fetching Fly apps" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"

# Cloudflare Workers (requires wrangler auth)
echo "⚡ Fetching Cloudflare Workers..."
echo "cloudflare_workers:" >> "$OUTPUT_FILE"
echo "  # Run 'wrangler deployments list' manually to update" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# MCP Servers (from current DEPLOYED.yml - these don't change often)
echo "🔌 Preserving MCP server config..."
echo "mcp_servers:" >> "$OUTPUT_FILE"
grep -A 100 "^mcp_servers:" "$REPO_PATH/DEPLOYED.yml" | grep -B 100 "^[a-z]" | head -n -1 >> "$OUTPUT_FILE" 2>/dev/null || echo "  # See original DEPLOYED.yml" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"

# Metadata
cat >> "$OUTPUT_FILE" << METADATA
metadata:
  last_sync: "$TIMESTAMP"
  synced_by: "scripts/sync-deployed.sh"
  version: "auto"
METADATA

echo ""
echo "✓ Generated $OUTPUT_FILE"
echo ""
echo "Review changes:"
echo "  diff $REPO_PATH/DEPLOYED.yml $OUTPUT_FILE"
echo ""
echo "To apply:"
echo "  mv $OUTPUT_FILE $REPO_PATH/DEPLOYED.yml"
