#!/bin/bash
set -e

# This script helps run the application locally with the correct migrations

# Check if PostgreSQL is running
echo "Checking if PostgreSQL is running..."
if ! pg_isready -h localhost -p 5432 -U agentops > /dev/null 2>&1; then
  echo "PostgreSQL is not running or not accessible with the agentops user."
  echo "Starting PostgreSQL and Redis with Docker Compose..."
  docker compose up -d postgres redis
  
  # Wait for PostgreSQL to be ready
  MAX_RETRIES=60
  RETRY_INTERVAL=5
  RETRIES=0
  
  until pg_isready -h localhost -p 5432 -U agentops > /dev/null 2>&1 || [ $RETRIES -eq $MAX_RETRIES ]; do
    echo "Waiting for PostgreSQL to be ready... Retry $((RETRIES+1))/$MAX_RETRIES"
    sleep $RETRY_INTERVAL
    RETRIES=$((RETRIES+1))
  done
  
  if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "Failed to connect to PostgreSQL after $MAX_RETRIES attempts."
    exit 1
  fi
  
  echo "PostgreSQL is ready!"
else
  echo "PostgreSQL is already running."
fi

# Run Prisma migrations
echo "Running database migrations..."
npx prisma migrate deploy

# Run orchestrator migrations
echo "Running orchestrator migrations..."
npm run orchestrator:migrate

# Run runtime migrations
echo "Running runtime migrations..."
npm run runtime:migrate

echo "All migrations completed successfully!"

# Start the application
echo "Starting the application..."
npm run dev