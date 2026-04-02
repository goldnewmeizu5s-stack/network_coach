#!/bin/sh

echo "Waiting for database..."
for i in $(seq 1 10); do
  node -e "
    const{PrismaClient}=require('@prisma/client');
    const p=new PrismaClient();
    p.\$queryRaw\`SELECT 1\`.then(()=>{console.log('DB ready');process.exit(0)}).catch(()=>process.exit(1))
  " && break
  echo "DB not ready, retrying in 2s... ($i/10)"
  sleep 2
done

echo "Running database push..."
npx prisma db push --schema=prisma/schema.prisma || echo "DB push failed, continuing..."

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
