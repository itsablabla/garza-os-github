FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Official Lark CLI (Go binary, MIT license) — handles Drive sync natively
RUN npm install -g @larksuite/cli@latest --no-audit --no-fund && \
    npm cache clean --force

# Sync-in Desktop CLI — pushes synced content to cloud.garzalabs.com
RUN curl -fsSL "https://github.com/Sync-in/desktop/releases/download/v2.2.1/sync-in-cli-2.2.1.js.tar.gz" \
    | tar -xz && \
    mv sync-in-cli-2.2.1.js sync-in-cli.js

COPY start.sh healthcheck.sh sync-wiki-bases.js ./
RUN chmod +x start.sh healthcheck.sh

VOLUME ["/data"]

# Lark credentials (loaded by lark-cli env credential provider)
ENV LARKSUITE_CLI_APP_ID=""
ENV LARKSUITE_CLI_APP_SECRET=""
ENV LARKSUITE_CLI_USER_ACCESS_TOKEN=""
ENV LARKSUITE_CLI_DEFAULT_AS="user"
ENV LARKSUITE_CLI_BRAND="lark"

# Root Drive folder token to sync from
ENV LARK_FOLDER_TOKEN="nodutfN0UnUSihjoh25GdBL6BMh"

# Sync-in target
ENV SYNCIN_URL=""
ENV SYNCIN_AUTH_ID=""
ENV SYNCIN_TOKEN=""
ENV SYNCIN_REMOTE_PATH="spaces/lark-docs/workspaces"

# Internal lark-mcp gateway (same Docker network) — used for wiki + bases sync
ENV LARK_MCP_URL="http://9o0rlv2llum5chtuyigaih5s:3000/intl/mcp"

ENV SYNC_INTERVAL_SECONDS=900

HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
  CMD ./healthcheck.sh

CMD ["./start.sh"]
