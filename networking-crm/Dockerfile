# Stage 1: Build client
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build server (with devDependencies for TypeScript compilation)
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY prisma/ ./prisma/
RUN npm install --workspace=server --include=dev
RUN npm install @prisma/client prisma
RUN npx prisma generate --schema=prisma/schema.prisma
COPY server/ ./server/
RUN npm run build --workspace=server

# Stage 3: Production dependencies only
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY prisma/ ./prisma/
RUN npm install --workspace=server --omit=dev
RUN npm install @prisma/client prisma
RUN npx prisma generate --schema=prisma/schema.prisma

# Stage 4: Production
FROM node:20-alpine
WORKDIR /app

# Copy server build output
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/

# Copy production-only node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/server/node_modules ./server/node_modules

# Copy prisma
COPY prisma/ ./prisma/
COPY --from=prod-deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps /app/node_modules/@prisma ./node_modules/@prisma

# Copy client dist
COPY --from=client-build /app/client/dist ./client/dist

# Copy seed data
COPY --from=server-build /app/server/dist/seed ./server/dist/seed

# Create uploads directory
RUN mkdir -p /app/server/uploads

# Copy startup script
COPY start.sh ./
RUN chmod +x start.sh

ENV NODE_ENV=production
EXPOSE 3001

CMD ["./start.sh"]
