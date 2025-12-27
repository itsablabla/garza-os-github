#!/bin/bash
# Test All SSH Paths - Health check all SSH routes
# Usage: ./test-all-paths.sh [--json]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECT_SCRIPT="$SCRIPT_DIR/connect.sh"

OUTPUT_JSON=false
if [ "$1" == "--json" ]; then
    OUTPUT_JSON=true
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

HOSTS=("garzahive" "mac" "boulder" "n8n" "octelium")
RESULTS=()

test_host() {
    local host="$1"
    local start_time=$(date +%s)
    
    if ! $OUTPUT_JSON; then
        echo -e "\n${YELLOW}Testing $host...${NC}"
    fi
    
    # Run connection test
    if output=$("$CONNECT_SCRIPT" "$host" "echo 'OK'" 2>&1); then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        if ! $OUTPUT_JSON; then
            echo -e "${GREEN}✓ $host: Connected (${duration}s)${NC}"
        fi
        
        RESULTS+=("{\"host\":\"$host\",\"status\":\"ok\",\"duration\":$duration}")
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        if ! $OUTPUT_JSON; then
            echo -e "${RED}✗ $host: Failed (${duration}s)${NC}"
            echo "$output" | sed 's/^/  /'
        fi
        
        RESULTS+=("{\"host\":\"$host\",\"status\":\"failed\",\"duration\":$duration}")
        return 1
    fi
}

# Main test loop
if ! $OUTPUT_JSON; then
    echo "========================================="
    echo "  SSH PATH HEALTH CHECK"
    echo "========================================="
fi

total=0
passed=0
failed=0

for host in "${HOSTS[@]}"; do
    ((total++))
    if test_host "$host"; then
        ((passed++))
    else
        ((failed++))
    fi
done

# Output results
if $OUTPUT_JSON; then
    # JSON output
    echo "{"
    echo "  \"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
    echo "  \"total\": $total,"
    echo "  \"passed\": $passed,"
    echo "  \"failed\": $failed,"
    echo "  \"results\": ["
    
    first=true
    for result in "${RESULTS[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi
        echo "    $result"
    done
    
    echo ""
    echo "  ]"
    echo "}"
else
    # Human-readable summary
    echo ""
    echo "========================================="
    echo "  SUMMARY"
    echo "========================================="
    echo -e "Total:  $total"
    echo -e "${GREEN}Passed: $passed${NC}"
    
    if [ $failed -gt 0 ]; then
        echo -e "${RED}Failed: $failed${NC}"
    else
        echo -e "Failed: $failed"
    fi
    
    echo ""
    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}All SSH paths operational ✓${NC}"
        exit 0
    else
        echo -e "${RED}Some SSH paths failed ✗${NC}"
        exit 1
    fi
fi
