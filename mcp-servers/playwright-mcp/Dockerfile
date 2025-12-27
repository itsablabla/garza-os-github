FROM mcr.microsoft.com/playwright/mcp

# Microsoft's official Playwright MCP server
# Exposes browser automation tools via MCP protocol

ENTRYPOINT ["node", "cli.js"]
CMD ["--headless", "--browser", "chromium", "--no-sandbox", "--port", "8931", "--host", "0.0.0.0", "--allowed-hosts", "*"]
