FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
EXPOSE 8080
CMD ["node", "--import", "./node_modules/tsx/dist/esm/index.cjs", "src/index.ts"]
