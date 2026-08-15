FROM oven/bun:1.3.14-alpine AS build
WORKDIR /src
RUN git clone --depth 1 https://github.com/HexSleeves/tailscale-mcp.git . \
 && bun install --frozen-lockfile \
 && bun run qa && bun run build

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_BIND_HOST=0.0.0.0
ENV MCP_HTTP_PORT=80
COPY --from=build /src/dist ./dist
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:80/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "dist/index.js", "--http", "--host", "0.0.0.0", "--port", "80"]
