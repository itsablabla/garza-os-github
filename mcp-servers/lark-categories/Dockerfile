FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js categories.json ./
ENV PORT=3000 NODE_OPTIONS=--max-old-space-size=512
EXPOSE 3000
CMD ["node", "server.js"]
