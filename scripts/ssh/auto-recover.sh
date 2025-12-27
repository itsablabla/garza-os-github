#!/bin/bash
# Auto-Recover SSH - Attempt to fix broken SSH connections
# Usage: ./auto-recover.sh <hostname>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECT_SCRIPT="$SCRIPT_DIR/connect.sh"
TEST_SCRIPT="$SCRIPT_DIR/test-all-paths.sh"

HOST_NAME="$1"

if [ -z "$HOST_NAME" ]; then
    echo "Usage: $0 <hostname>"
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Recovery strategies per host
recover_garzahive() {
    log_info "Starting recovery for garzahive..."
    
    # Step 1: Try simple reconnect
    log_step "1/4 Attempting simple reconnect..."
    if "$CONNECT_SCRIPT" garzahive "uptime" >/dev/null 2>&1; then
        log_info "✓ Simple reconnect worked!"
        return 0
    fi
    
    # Step 2: Check if host is responding to ping
    log_step "2/4 Checking network connectivity..."
    if ping -c 3 64.227.106.134 >/dev/null 2>&1; then
        log_info "✓ Host is responding to ping"
    else
        log_warn "✗ Host not responding to ping - may be network issue"
    fi
    
    # Step 3: Try restarting SSH service via DigitalOcean API
    log_step "3/4 Attempting SSH service restart via DO API..."
    log_warn "DigitalOcean API restart not yet implemented"
    log_warn "Manual action required: Log into DO console and reboot droplet"
    
    # Step 4: Last resort - suggest manual intervention
    log_step "4/4 Checking if any fallback paths work..."
    if "$CONNECT_SCRIPT" garzahive "uptime" >/dev/null 2>&1; then
        log_info "✓ Recovery successful via fallback path!"
        return 0
    fi
    
    log_error "All recovery attempts failed for garzahive"
    log_error "Manual intervention required:"
    log_error "  1. Check DigitalOcean console for droplet status"
    log_error "  2. Verify Cloudflare Tunnel is running"
    log_error "  3. Check firewall rules on droplet"
    return 1
}

recover_mac() {
    log_info "Starting recovery for mac..."
    
    # Step 1: Try simple reconnect
    log_step "1/3 Attempting simple reconnect..."
    if "$CONNECT_SCRIPT" mac "echo OK" >/dev/null 2>&1; then
        log_info "✓ Simple reconnect worked!"
        return 0
    fi
    
    # Step 2: Check Cloudflare Tunnel status
    log_step "2/3 Checking Cloudflare Tunnel status..."
    log_warn "CF Tunnel check not yet implemented"
    log_warn "Tunnel runs on this host - check manually with: cloudflared tunnel info"
    
    # Step 3: This IS the local Mac - try local shell
    log_step "3/3 This is the local Mac - trying local execution..."
    log_info "Mac is the local host - if SSH fails, CF MCP shell_exec should work"
    
    log_error "Recovery failed for mac"
    log_error "Manual intervention required:"
    log_error "  1. Check if cloudflared is running"
    log_error "  2. Restart cloudflared tunnel: sudo launchctl unload/load cloudflared"
    return 1
}

recover_boulder() {
    log_info "Starting recovery for boulder..."
    
    # Step 1: Try simple reconnect
    log_step "1/3 Attempting simple reconnect..."
    if "$CONNECT_SCRIPT" boulder "echo OK" >/dev/null 2>&1; then
        log_info "✓ Simple reconnect worked!"
        return 0
    fi
    
    # Step 2: Try local network fallback
    log_step "2/3 Trying local network (192.168.4.81)..."
    if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no jadengarza@192.168.4.81 "echo OK" >/dev/null 2>&1; then
        log_info "✓ Local network connection works!"
        log_warn "Cloudflare Tunnel may be down - check tunnel status"
        return 0
    fi
    
    # Step 3: Suggest manual intervention
    log_step "3/3 All automatic recovery failed"
    
    log_error "Recovery failed for boulder"
    log_error "Manual intervention required:"
    log_error "  1. Check if boulder Mac mini is powered on"
    log_error "  2. Check Cloudflare Tunnel status on boulder"
    log_error "  3. If on local network, try: ssh jadengarza@192.168.4.81"
    return 1
}

recover_n8n() {
    log_info "Starting recovery for n8n..."
    
    # Step 1: Try simple reconnect
    log_step "1/2 Attempting simple reconnect..."
    if "$CONNECT_SCRIPT" n8n "uptime" >/dev/null 2>&1; then
        log_info "✓ Simple reconnect worked!"
        return 0
    fi
    
    # Step 2: Suggest manual intervention
    log_step "2/2 Checking DigitalOcean status..."
    log_warn "DigitalOcean API check not yet implemented"
    
    log_error "Recovery failed for n8n"
    log_error "Manual intervention required:"
    log_error "  1. Check DigitalOcean console for droplet status"
    log_error "  2. Verify firewall rules allow SSH"
    return 1
}

recover_octelium() {
    log_info "Starting recovery for octelium..."
    
    # Step 1: Try simple reconnect
    log_step "1/2 Attempting simple reconnect..."
    if "$CONNECT_SCRIPT" octelium "uptime" >/dev/null 2>&1; then
        log_info "✓ Simple reconnect worked!"
        return 0
    fi
    
    # Step 2: Suggest manual intervention
    log_step "2/2 Checking DigitalOcean status..."
    log_warn "DigitalOcean API check not yet implemented"
    
    log_error "Recovery failed for octelium"
    log_error "Manual intervention required:"
    log_error "  1. Check DigitalOcean console for droplet status"
    log_error "  2. Verify Cloudflare Tunnel is running"
    log_error "  3. Check firewall rules on droplet"
    return 1
}

# Main recovery router
echo "========================================="
echo "  SSH AUTO-RECOVERY"
echo "========================================="
echo ""

case "$HOST_NAME" in
    garzahive)
        recover_garzahive
        ;;
    mac)
        recover_mac
        ;;
    boulder)
        recover_boulder
        ;;
    n8n)
        recover_n8n
        ;;
    octelium)
        recover_octelium
        ;;
    *)
        log_error "Unknown host: $HOST_NAME"
        exit 1
        ;;
esac

exit_code=$?

echo ""
echo "========================================="
if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}Recovery successful ✓${NC}"
else
    echo -e "${RED}Recovery failed ✗${NC}"
fi
echo "========================================="

exit $exit_code
