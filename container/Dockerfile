FROM node:20-slim

RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Download droid binary
RUN curl -fsSL "https://downloads.factory.ai/factory-cli/releases/0.129.0/linux/x64/droid" \
    -o /usr/local/bin/droid && chmod +x /usr/local/bin/droid

# Pre-create factory dirs
RUN mkdir -p /root/.factory/cache/certs

WORKDIR /app
COPY server.js .
COPY package.json .

RUN npm install --production

ENV PORT=8080
ENV HOME=/root
EXPOSE 8080

CMD ["node", "server.js"]
