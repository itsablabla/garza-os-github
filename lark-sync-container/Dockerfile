FROM node:20-alpine

WORKDIR /app

# Download sync-in CLI
RUN apk add --no-cache curl && \
    curl -fsSL "https://github.com/Sync-in/desktop/releases/download/v2.2.1/sync-in-cli-2.2.1.js.tar.gz" \
      | tar -xz && \
    mv sync-in-cli-2.2.1.js sync-in-cli.js

COPY fetch-lark.js ./
COPY start.sh ./
RUN chmod +x start.sh

# Persistent volume for synced Lark content
VOLUME ["/data/lark-sync"]

ENV LARK_MCP_URL=http://9o0rlv2llum5chtuyigaih5s:3000/intl/mcp
ENV OUTPUT_DIR=/data/lark-sync
ENV SYNC_INTERVAL_MS=900000

CMD ["./start.sh"]
