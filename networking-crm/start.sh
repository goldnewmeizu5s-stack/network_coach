#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --schema=prisma/schema.prisma --accept-data-loss 2>/dev/null || echo "DB push completed (or skipped)"

echo "Checking seed data..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.methodology.count().then(async (count) => {
  if (count === 0) {
    console.log('Seeding methodologies...');
    require('./server/dist/seed/methodologies');
  } else {
    console.log('Methodologies already seeded (' + count + ')');
  }
  await prisma.\$disconnect();
}).catch((e) => { console.error('Seed check failed:', e.message); });
" 2>/dev/null || echo "Seed check skipped"

echo "Starting server..."
node server/dist/index.js
