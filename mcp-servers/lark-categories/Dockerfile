FROM node:20-alpine
RUN cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|MemFree' ; free -m | head -2 ; nproc
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js categories.json ./
ENV PORT=3000 NODE_OPTIONS=--max-old-space-size=1536
EXPOSE 3000
CMD ["node", "server.js"]
