FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
ENV AUTH_DIR=/data/auth PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
