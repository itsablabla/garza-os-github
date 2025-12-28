#!/bin/bash
# Health check script for Desktop Commander

# Check if Desktop Commander is responsive
# This is a simple HTTP health endpoint

# Check if we can run basic commands
if ! which python3 > /dev/null 2>&1; then
    echo "ERROR: python3 not found"
    exit 1
fi

if ! which git > /dev/null 2>&1; then
    echo "ERROR: git not found"
    exit 1
fi

if ! which node > /dev/null 2>&1; then
    echo "ERROR: node not found"
    exit 1
fi

# Check if Desktop Commander MCP server is running
if ! pgrep -f "desktop-commander" > /dev/null 2>&1; then
    echo "ERROR: Desktop Commander not running"
    exit 1
fi

# Check disk space (fail if less than 10% free)
DISK_USAGE=$(df /workspace | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    echo "WARNING: Disk usage at ${DISK_USAGE}%"
fi

# Check memory (warn if over 80%)
MEM_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
if [ "$MEM_USAGE" -gt 80 ]; then
    echo "WARNING: Memory usage at ${MEM_USAGE}%"
fi

# Return JSON health status
cat << EOF
{
  "status": "healthy",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "checks": {
    "python": "ok",
    "git": "ok",
    "node": "ok",
    "desktop_commander": "ok",
    "disk_usage": "${DISK_USAGE}%",
    "memory_usage": "${MEM_USAGE}%"
  }
}
EOF

exit 0