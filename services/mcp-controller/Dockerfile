FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install

COPY server.js ./

# Persistent storage for session
RUN mkdir -p /data

ENV PORT=8080
ENV SESSION_FILE=/data/session.json

EXPOSE 8080

CMD ["node", "server.js"]
