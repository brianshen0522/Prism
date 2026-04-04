#!/bin/sh
set -e

# Construct PRISM_DATABASE_URL for the Prisma CLI (mirrors config.ts logic)
# The CLI doesn't run through Node so it needs the URL directly.
export PRISM_DATABASE_URL="postgresql://${PROXY_DB_USER}:${PROXY_DB_PASS}@${PROXY_DB_HOST}:${PROXY_DB_PORT:-5432}/${PROXY_DB_NAME}"

echo "Applying Prism DB schema..."
node_modules/.bin/prisma db push --schema=prisma/schema.prisma --skip-generate

echo "Starting Prism..."
exec node dist/index.js
