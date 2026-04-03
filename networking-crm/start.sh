#!/bin/sh

echo "Running prisma db push..."
npx prisma db push --schema=prisma/schema.prisma --accept-data-loss 2>&1 || echo "DB push warning, continuing..."

echo "Running seed check..."
node -e "
  const{PrismaClient}=require('@prisma/client');
  const p=new PrismaClient();
  p.methodology.count().then(async(c)=>{
    if(c===0){console.log('Seeding...');require('./server/dist/seed/methodologies')}
    else{console.log('Already seeded: '+c)}
    await p.\$disconnect()
  }).catch(e=>{console.error('Seed:',e.message)})
" 2>&1 || echo "Seed warning, continuing..."

echo "Starting server..."
exec node server/dist/index.js
