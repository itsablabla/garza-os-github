#!/bin/bash
# GARZA OS Quick Status
# Checks what Claude can access right now via MCP

echo "🔌 GARZA OS MCP Status"
echo "======================"
echo ""
echo "This script shows what to test via MCP tools:"
echo ""
echo "CF MCP:          CF MCP:ping"
echo "Garza Hive:      Garza Hive MCP:ping"
echo "SSH Backup:      SSH Back Up:ping"
echo "Telnet Backup:   Telnet Back Up:ping"
echo "Garza Home:      Garza Home MCP:ping"
echo "N8N Server:      N8N Garza Hive Server:ping"
echo "Craft:           Craft:folders_list"
echo ""
echo "If any fail, check:"
echo "1. Fly.io app status: flyctl status -a <app-name>"
echo "2. Worker status: wrangler tail <worker-name>"
echo "3. Network/DNS issues"
echo ""
echo "Vault access: CF MCP:list_secrets"
echo "File access:  CF MCP:fs_list_directory"
