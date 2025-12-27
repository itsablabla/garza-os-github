FROM ghcr.io/puppeteer/puppeteer:21.0.0

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --only=production

# Copy server
COPY server.js ./

# Expose port
EXPOSE 8931

# Run
CMD ["node", "server.js"]
