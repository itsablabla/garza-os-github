FROM node:20-alpine
WORKDIR /app
RUN npm install -g mcp-proxy@6.6.0 && npm install @takescake/1password-mcp@4.0.1 --no-audit --no-fund && npm cache clean --force
ENV NODE_PATH=/app/node_modules
EXPOSE 8080
CMD ["mcp-proxy", "--", "npx", "--no-install", "-y", "@takescake/1password-mcp"]
