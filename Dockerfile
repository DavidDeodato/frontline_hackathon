FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY web ./web
COPY public ./public
COPY shared ./shared
COPY vite.config.js ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 FRONTLINE_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY runtime ./runtime
COPY shared ./shared
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["npm","start"]
