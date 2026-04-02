# Stage 1: Build client
FROM node:20-alpine AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
WORKDIR /app/client
RUN npm install --ignore-scripts
WORKDIR /app
COPY client/ ./client/
WORKDIR /app/client
RUN npm run build

# Stage 2: Build server
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY prisma/ ./prisma/
RUN npm install --workspace=server --include=dev
RUN npm install @prisma/client prisma
RUN npx prisma generate --schema=prisma/schema.prisma
COPY server/ ./server/
RUN npm run build --workspace=server

# Stage 3: Production
FROM node:20-alpine
WORKDIR /app

# Copy server build output
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/server/node_modules ./server/node_modules

# Copy prisma
COPY prisma/ ./prisma/
COPY --from=server-build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=server-build /app/node_modules/@prisma ./node_modules/@prisma

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
