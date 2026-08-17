FROM node:20-alpine
WORKDIR /app
RUN npm install -g mcp-proxy@6.6.0 && npm install @e2b/mcp-server --no-audit --no-fund && npm cache clean --force
ENV NODE_PATH=/app/node_modules
EXPOSE 8080
CMD ["sh", "-c", "mcp-proxy --apiKey \"$MCP_PROXY_API_KEY\" -- npx --no-install -y @e2b/mcp-server"]
