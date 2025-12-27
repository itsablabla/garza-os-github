# Use Playwright's Docker image which has all browser deps
FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --only=production

# Copy server code
COPY server.js ./

# Expose port
EXPOSE 8931

# Run server
CMD ["node", "server.js"]
