#!/bin/sh

# Fix DATABASE_URL protocol if needed (Railway sometimes provides mysql:// or other formats)
if [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    postgresql://*|postgres://*)
      ;; # already correct
    *)
      # Replace everything before :// with postgresql
      export DATABASE_URL="postgresql://${DATABASE_URL#*://}"
      echo "Fixed DATABASE_URL protocol to postgresql://"
      ;;
  esac
fi

echo "Ensuring pgvector memory schema..."
npx prisma db execute --file prisma/init-memory.sql --schema=prisma/schema.prisma 2>&1 || echo "Memory init warning, continuing..."

echo "Running prisma db push..."
npx prisma db push --schema=prisma/schema.prisma 2>&1 || echo "DB push warning, continuing..."

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
