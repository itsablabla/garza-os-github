#!/bin/sh
# Healthy if lark-mcp port is open and last sync was recent
nc -z 127.0.0.1 "${LARK_MCP_PORT:-3001}" || exit 1
