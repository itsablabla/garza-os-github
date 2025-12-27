#!/bin/bash
# Smart SSH Connector - Tries all connection paths from hosts.yml
# Usage: ./connect.sh <hostname> <command>
# Example: ./connect.sh garzahive "uptime"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOSTS_FILE="$REPO_ROOT/infra/hosts.yml"

HOST_NAME="$1"
COMMAND="${2:-echo 'Connected'}"

if [ -z "$HOST_NAME" ]; then
    echo "Usage: $0 <hostname> [command]"
    echo ""
    echo "Available hosts:"
    grep "^  [a-z]" "$HOSTS_FILE" | sed 's/://g' | awk '{print "  - " $1}'
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Extract host config from YAML (simple parsing)
get_yaml_value() {
    local key="$1"
    grep "^\s*$key:" "$HOSTS_FILE" | awk '{print $2}' | tr -d '"' | head -1
}

# Try primary SSH connection
try_primary_ssh() {
    local host="$1"
    local user="$2"
    local port="${3:-22}"
    local timeout="${4:-10}"
    
    log_info "Trying primary SSH: $user@$host:$port"
    
    if timeout "$timeout" ssh -o ConnectTimeout="$timeout" \
                               -o StrictHostKeyChecking=no \
                               -o UserKnownHostsFile=/dev/null \
                               -o LogLevel=ERROR \
                               -p "$port" \
                               "$user@$host" \
                               "$COMMAND" 2>/dev/null; then
        log_info "✓ Primary SSH succeeded"
        return 0
    else
        log_warn "✗ Primary SSH failed"
        return 1
    fi
}

# Try SSH via relay (jump host)
try_relay_ssh() {
    local target_host="$1"
    local target_user="$2"
    local relay_host="$3"
    local relay_user="$4"
    
    log_info "Trying SSH relay: $relay_user@$relay_host → $target_user@$target_host"
    
    if timeout 15 ssh -o ConnectTimeout=10 \
                       -o StrictHostKeyChecking=no \
                       -o UserKnownHostsFile=/dev/null \
                       -o LogLevel=ERROR \
                       -J "$relay_user@$relay_host" \
                       "$target_user@$target_host" \
                       "$COMMAND" 2>/dev/null; then
        log_info "✓ Relay SSH succeeded"
        return 0
    else
        log_warn "✗ Relay SSH failed"
        return 1
    fi
}

# Host-specific connection strategies
connect_garzahive() {
    local host="64.227.106.134"
    local user="root"
    
    # Try 1: Direct SSH
    if try_primary_ssh "$host" "$user" 22 10; then
        return 0
    fi
    
    # Try 2: SSH via Mac relay
    log_info "Fallback 1: Trying SSH relay via Mac"
    if try_relay_ssh "$host" "$user" "ssh.garzahive.com" "customer"; then
        return 0
    fi
    
    # Try 3: lrlab-mcp ssh_exec tool
    log_info "Fallback 2: Trying lrlab-mcp ssh_exec tool"
    log_warn "MCP tool fallback not implemented in bash - use Python wrapper"
    
    # Try 4: CF MCP ssh_exec tool
    log_info "Fallback 3: Trying cf-mcp ssh_exec tool"
    log_warn "MCP tool fallback not implemented in bash - use Python wrapper"
    
    log_error "All connection methods failed for garzahive"
    return 1
}

connect_mac() {
    local host="ssh.garzahive.com"
    local user="customer"
    
    # Try 1: Direct SSH via Cloudflare Tunnel
    if try_primary_ssh "$host" "$user" 22 10; then
        return 0
    fi
    
    # Try 2: CF MCP shell_exec (if running locally)
    log_info "Fallback 1: CF MCP shell_exec"
    log_warn "MCP tool fallback not implemented in bash - this host is local"
    
    log_error "All connection methods failed for mac"
    return 1
}

connect_boulder() {
    local host="boulder-ssh.garzahive.com"
    local user="jadengarza"
    
    # Try 1: Direct SSH via Cloudflare Tunnel
    if try_primary_ssh "$host" "$user" 22 10; then
        return 0
    fi
    
    # Try 2: Local network (if on same LAN)
    log_info "Fallback 1: Trying local network 192.168.4.81"
    if try_primary_ssh "192.168.4.81" "$user" 22 10; then
        return 0
    fi
    
    log_error "All connection methods failed for boulder"
    return 1
}

connect_n8n() {
    local host="167.172.147.240"
    local user="root"
    
    # Try 1: Direct SSH
    if try_primary_ssh "$host" "$user" 22 10; then
        return 0
    fi
    
    # Try 2: lrlab-mcp ssh_exec tool
    log_info "Fallback 1: Trying lrlab-mcp ssh_exec tool"
    log_warn "MCP tool fallback not implemented in bash - use Python wrapper"
    
    log_error "All connection methods failed for n8n"
    return 1
}

connect_octelium() {
    local host="68.183.108.79"
    local user="root"
    
    # Try 1: Direct SSH
    if try_primary_ssh "$host" "$user" 22 10; then
        return 0
    fi
    
    log_error "All connection methods failed for octelium"
    return 1
}

# Main connection router
case "$HOST_NAME" in
    garzahive)
        connect_garzahive
        ;;
    mac)
        connect_mac
        ;;
    boulder)
        connect_boulder
        ;;
    n8n)
        connect_n8n
        ;;
    octelium)
        connect_octelium
        ;;
    *)
        log_error "Unknown host: $HOST_NAME"
        echo ""
        echo "Available hosts:"
        echo "  - garzahive"
        echo "  - mac"
        echo "  - boulder"
        echo "  - n8n"
        echo "  - octelium"
        exit 1
        ;;
esac

exit $?
