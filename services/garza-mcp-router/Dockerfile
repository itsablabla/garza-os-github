FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production=false
COPY src ./src
COPY tsconfig.json ./
EXPOSE 8080
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
