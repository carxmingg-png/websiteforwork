FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY *.ts ./
COPY *.json ./
COPY keys* ./

RUN npm install
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/*.json ./
COPY --from=builder /app/*.ts ./
COPY --from=builder /app/keys* ./

EXPOSE 10000

CMD ["node", "dist/server.cjs"]
