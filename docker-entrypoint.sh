#!/bin/sh
set -e

# Run prisma migrations on every startup to ensure the DB is up to date
echo "Running Prisma migrations..."
npx prisma migrate deploy

# Execute the CMD from the Dockerfile
exec "$@"
