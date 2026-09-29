FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
