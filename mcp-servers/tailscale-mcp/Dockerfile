FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
RUN apk add --no-cache git
RUN git clone --depth 1 https://github.com/HexSleeves/tailscale-mcp.git .
# Allow public hostname through MCP SDK DNS-rebinding middleware (defaults to localhost-only).
RUN sed -i 's/const app = createMcpExpressApp();/const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: ["tailscale-mcp.garzalabs.com", "localhost", "127.0.0.1"] });/' src/mcp/transports/http.ts
RUN bun install --frozen-lockfile

FROM deps AS build
RUN bun run build

FROM oven/bun:1.3.14-alpine AS production
WORKDIR /app
ENV NODE_ENV=production MCP_TRANSPORT=http MCP_HTTP_BIND_HOST=0.0.0.0 MCP_HTTP_PORT=80
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD bun -e "fetch('http://127.0.0.1:80/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "dist/index.js", "--http", "--host", "0.0.0.0", "--port", "80"]
