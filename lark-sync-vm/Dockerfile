FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl netcat-openbsd

# Pre-install lark-mcp globally — no npx download at runtime
RUN npm install -g @larksuiteoapi/lark-mcp --no-audit --no-fund && \
    npm cache clean --force

# Download Sync-in Desktop CLI
RUN curl -fsSL "https://github.com/Sync-in/desktop/releases/download/v2.2.1/sync-in-cli-2.2.1.js.tar.gz" \
    | tar -xz && \
    mv sync-in-cli-2.2.1.js sync-in-cli.js

COPY fetch-lark.js start.sh ./
RUN chmod +x start.sh

VOLUME ["/data/lark-sync"]

# Lark MCP runs on localhost — no external container dependency
ENV LARK_MCP_URL=http://127.0.0.1:3001/mcp
ENV LARK_MCP_PORT=3001
ENV LARK_DOMAIN=https://open.larksuite.com
ENV OUTPUT_DIR=/data/lark-sync
ENV SYNC_INTERVAL_MS=900000

CMD ["./start.sh"]
