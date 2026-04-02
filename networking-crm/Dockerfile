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

COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/

COPY --from=prod-deps /app/node_modules ./node_modules

COPY prisma/ ./prisma/
COPY --from=prod-deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps /app/node_modules/@prisma ./node_modules/@prisma

COPY --from=client-build /app/client/dist ./client/dist

COPY --from=server-build /app/server/dist/seed ./server/dist/seed

RUN mkdir -p /app/server/uploads

COPY start.sh ./
RUN chmod +x start.sh

ENV NODE_ENV=production
EXPOSE 3001

CMD ["./start.sh"]
