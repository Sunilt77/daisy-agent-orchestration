# Running the Application Locally

This guide explains how to run the application locally with PostgreSQL. The application requires several database migrations to be run before it can start properly.

## Option 1: Run everything in Docker (Recommended)

This is the simplest approach as it containerizes both the application and its dependencies. The entrypoint script will automatically run all necessary migrations.

```bash
# Start all services (PostgreSQL, Redis, and the application)
docker compose up

# Or to run in detached mode
docker compose up -d

# To stop all services
docker compose down
```

## Option 2: Run PostgreSQL in Docker, Application on Host

This approach runs only the database services in Docker while running the application directly on your host machine.

```bash
# Use the provided script to handle migrations and startup
./run-local.sh

# Or do it manually:
# Start only the database services
docker compose up postgres redis -d

# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run all necessary migrations
npx prisma migrate deploy
npm run orchestrator:migrate
npm run runtime:migrate

# Start the application
npm run dev
```

## Option 3: Run Application in Docker, PostgreSQL on Host

If you already have PostgreSQL installed locally, you can run just the application in Docker.

1. Make sure PostgreSQL is running locally on port 5432 with:
   - Database name: agentops
   - Username: agentops
   - Password: agentops

2. Build and run the Docker container:

```bash
# Build the container
docker build -t agentic-orchestrator .

# Run the container with the host.docker.internal mapping
docker run -p 3000:3000 --add-host=host.docker.internal:host-gateway -e DATABASE_URL="postgresql://agentops:agentops@host.docker.internal:5432/agentops?schema=public" agentic-orchestrator
```

## Troubleshooting

### Missing Database Tables

If you see errors like `The table 'public.orchestrator_job_queue' does not exist in the current database`, it means you need to run the required migrations:

```bash
# Run all necessary migrations in this order:
npx prisma migrate deploy
npm run orchestrator:migrate
npm run runtime:migrate
```

### Connection Issues

If you're having trouble connecting to PostgreSQL, check:
1. PostgreSQL is running and accessible
2. The DATABASE_URL environment variable is correct
3. The user has proper permissions

## Environment Variables

The application uses the following environment variables, which can be set in a `.env` file:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `APP_SECRET`: Secret for session encryption
- `SESSION_DAYS`: Number of days a session remains valid
- `PLATFORM_ADMIN_EMAILS`: Admin emails

## Database Migrations

The application requires three types of migrations:

```bash
# Core database schema (Prisma)
npx prisma migrate deploy

# Orchestrator-specific tables
npm run orchestrator:migrate

# Runtime-specific tables
npm run runtime:migrate
```

## Seeding the Database

To seed the database with initial data:

```bash
npm run seed
```