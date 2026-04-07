# Stage 1: Build client
FROM node:20-alpine AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY prisma/ ./prisma/
RUN npm ci
COPY client/ ./client/
RUN npm run build --workspace=client

# Stage 2: Build server
FROM node:20-alpine AS server-build
WORKDIR /app
RUN apk add --no-cache openssl openssl-dev
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY prisma/ ./prisma/
RUN npm ci
RUN npx prisma generate --schema=prisma/schema.prisma
COPY server/ ./server/
RUN npm run build --workspace=server

# Stage 3: Production dependencies
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl openssl-dev
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY prisma/ ./prisma/
RUN npm ci --omit=dev
RUN npm install prisma
RUN npx prisma generate --schema=prisma/schema.prisma

# Stage 4: Production
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl curl

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/

COPY --from=prod-deps /app/node_modules ./node_modules

COPY prisma/ ./prisma/
COPY --from=prod-deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps /app/node_modules/@prisma ./node_modules/@prisma

COPY --from=client-build /app/client/dist ./client/dist

COPY --from=server-build /app/server/dist/seed ./server/dist/seed

RUN mkdir -p /app/server/uploads && chown -R appuser:appgroup /app

COPY start.sh ./
RUN chmod +x start.sh

USER appuser

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["./start.sh"]
