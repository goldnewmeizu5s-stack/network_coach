#!/bin/sh

echo "Running database push..."
npx prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 || echo "DB push failed, continuing..."

echo "Checking seed data..."
node -e "
  const{PrismaClient}=require('@prisma/client');
  const p=new PrismaClient();
  p.methodology.count().then(async(c)=>{
    if(c===0){console.log('Seeding...');require('./server/dist/seed/methodologies')}
    else{console.log('Already seeded ('+c+')')}
    await p.\$disconnect()
  }).catch(e=>{console.error('Seed error:',e.message);process.exit(0)})
" || echo "Seed check failed, continuing..."

echo "Starting server..."
exec node server/dist/index.js
