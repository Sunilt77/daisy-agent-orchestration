# Agentic Orchestrator

A full-stack AI orchestration platform to build agents, crews, tools, MCP exposures, chat/runs, and observability traces.

## Architecture

```text
Browser (React + Vite)
  -> Express API (server.ts, port 3000)
    -> Local orchestrator DB (SQLite: orchestrator.db)
    -> Platform DB (Postgres via Prisma)
    -> LLM providers (Google/OpenAI/Anthropic)
    -> MCP client + MCP server transports (SSE + Streamable HTTP)
```

```mermaid
flowchart LR
  UI[React UI Pages] --> API[Express API server.ts]
  API --> SQLI[(SQLite orchestrator.db)]
  API --> PG[(Postgres via Prisma)]
  API --> LLM[LLM Providers]
  API --> MCPClient[MCP Client Transports]
  Ext[External MCP Clients] --> MCPSSE[/mcp/sse + /mcp/messages]
  Ext --> MCPManifest[/mcp/manifest]
  MCPSSE --> API
  MCPManifest --> API
```

Detailed architecture notes:

- Current platform architecture: `ARCHITECTURE.md`
- Multi-tenant agent runtime and delegated MCP design: `docs/multi-tenant-agent-runtime.md`
- Application-side MCP gateway verification reference: `docs/application-mcp-gateway-reference.md`

## Main Modules

- `src/pages/*`: UI for Agents, Crews, Tools, MCPs, Traces, Platform, Credentials, Providers, Pricing.
- `server.ts`: Main API, orchestration runtime, MCP endpoints, tool execution, crew execution, run controls.
- `src/db.ts`: Local SQLite schema + bootstrap for orchestrator data.
- `src/platform/*`: Platform auth, API keys, ingestion routes, Prisma integration.
- `prisma/schema.prisma`: Postgres models for orgs/users/projects/runs/events/pricing.
- `test/*`: Integration + runtime + UI builder tests (Vitest).

## Dependencies

Required:
- Node.js `>=20` (recommended LTS)
- npm `>=10`

Optional but recommended:
- Docker Desktop (for local Postgres via `docker compose`)

External service keys (as needed):
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` (optional, enables built-in `google_search` tool)
- `AGENTOPS_API_KEY` (optional observability)
- `REDIS_URL` (recommended for Cloud Run / distributed coordination)

## Environment Setup

1. Copy env file:
```bash
cp .env.example .env
```
2. Update minimum required values in `.env`:
- `DATABASE_URL` (Postgres for platform module)
- `APP_SECRET` (32+ chars)
- `EXECUTION_CONTEXT_TOKEN_SECRET` (recommended dedicated 32+ char secret)
- `DELEGATED_TOOL_TOKEN_SECRET` (recommended dedicated 32+ char secret)
- `EXECUTION_CONTEXT_TOKEN_AUDIENCE` (default `agentic-orchestrator`)
- `DELEGATED_TOOL_TOKEN_AUDIENCE` (default `app-mcp-gateway`)
- At least one LLM API key
- Optional Cloud Run state sync:
  - `SQLITE_PATH` (use `/tmp/orchestrator/orchestrator.db`)
  - `GCS_SQLITE_BUCKET`
  - `GCS_SQLITE_PREFIX`
  - `GCS_SYNC_INTERVAL_MS`
- Optional MCP startup latency tuning:
  - `MCP_MANIFEST_CACHE_TTL_MS` (default `120000`)
  - `MCP_MANIFEST_PREWARM_ENABLED` (default `true`)
  - `MCP_MANIFEST_PREWARM_INTERVAL_MS` (default `60000`)
  - `MCP_MANIFEST_PREWARM_MAX_ENDPOINTS` (default `40`)

### Secret Dependency Map

- `APP_SECRET`
  - platform auth/session signing
  - platform crypto helpers (API key/session related)
  - fallback secret if dedicated token secrets are not set
- `EXECUTION_CONTEXT_TOKEN_SECRET`
  - signing/verifying execution-context tokens
  - used by `/api/v2/execution-contexts`, `/api/v2/agent-runs/chat`, `/api/v2/agent-runs/chat/stream`
- `DELEGATED_TOOL_TOKEN_SECRET`
  - signing/verifying delegated gateway tool tokens
  - used by remote gateway tool execution path (`mcp_remote_gateway`)

Production recommendation: keep all three secrets different so you can rotate one trust boundary without impacting others.

## MCP Startup Performance

The runtime includes three optimizations to reduce delay at `Preparing tools and execution context...`:

- Parallel MCP manifest discovery across configured MCP endpoints.
- In-memory MCP manifest cache (TTL-based) to avoid repeated `listTools` on every chat turn.
- Lazy MCP connection for execution: MCP clients connect on first actual MCP tool call, not during every turn prep.

Background prewarm scheduler:

- Periodically prewarms MCP manifests for active agent/tool bindings.
- Writes cache entries before user chats hit the endpoint.
- Emits prewarm logs: `[mcp-prewarm] ready in ...`.

Runtime observability fields (OpenTelemetry span attributes):

- `tool_prep.duration_ms`
- `tool_prep.scoped_tool_count`
- `tool_prep.mcp_endpoint_count`
- `tool_prep.mcp_exposed_tool_count`
- `tool_prep.mcp_manifest_cache_hits`

Recommended local defaults:

```env
MCP_MANIFEST_CACHE_TTL_MS=120000
MCP_MANIFEST_PREWARM_ENABLED=true
MCP_MANIFEST_PREWARM_INTERVAL_MS=60000
MCP_MANIFEST_PREWARM_MAX_ENDPOINTS=40
```

## How To Run

1. Install dependencies:
```bash
npm install
```
2. Start Postgres:
```bash
npm run db:up
```
3. Generate Prisma client:
```bash
npm run prisma:generate
```
4. Run migrations:
```bash
npm run prisma:migrate
```
5. Optional seed:
```bash
npm run seed
```
6. Start app:
```bash
npm run dev
```
7. Open:
- `http://localhost:3000`
- Auth page: `http://localhost:3000/auth`
- Platform page: `http://localhost:3000/platform`
- Traces page: `http://localhost:3000/traces`

## Data Stores

- SQLite (`orchestrator.db`): agents, crews, tools, MCP exposures, local run/execution state.
- Postgres (`DATABASE_URL`): orgs/users/projects/runs/events/pricing for platform ingestion and analytics.

## Useful Scripts

- `npm run dev` -> start full app (Express + Vite middleware)
- `npm run start:cloudrun` -> Cloud Run bootstrap (restore/sync SQLite via GCS + start API)
- `npm run build` -> build frontend assets
- `npm run preview` -> preview built frontend
- `npm run lint` -> TypeScript type-check
- `npm test` -> run all tests (Vitest)
- `npm run db:up` -> start Postgres container
- `npm run db:down` -> stop Postgres container
- `npm run prisma:generate` -> generate Prisma client
- `npm run prisma:migrate` -> apply/create migrations
- `npm run orchestrator:migrate` -> copy persistent orchestrator entities from SQLite into Postgres
- `npm run seed` -> seed demo data
- `npm run reset-password` -> reset a user password

## API Surface (Quick Reference)

- Auth:
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Agents:
  - `GET /api/agents`
  - `POST /api/agents`
  - `PUT /api/agents/:id`
  - `DELETE /api/agents/:id`
  - `POST /api/agents/:id/run`
  - `POST /api/agents/:id/chat`
  - `POST /api/agents/:id/stop-all`
- Crews:
  - `GET /api/crews`
  - `POST /api/crews`
  - `PUT /api/crews/:id`
  - `DELETE /api/crews/:id`
  - `POST /api/crews/:id/kickoff`
- Tools:
  - `GET /api/tools`
  - `POST /api/tools`
  - `PUT /api/tools/:id`
  - `DELETE /api/tools/:id`
  - `POST /api/tools/http-test`
  - `POST /api/tools/mcp-test`
- MCP:
  - `GET /api/mcp/exposed-tools`
  - `PUT /api/mcp/exposed-tools/:toolId`
  - `GET /api/mcp/bundles`
  - `POST /api/mcp/bundles`
  - `DELETE /api/mcp/bundles/:id`
  - `GET /mcp/sse`
  - `POST /mcp/messages`
  - `GET /mcp/manifest`
- Platform ingestion/analytics:
  - `POST /api/v1/runs`
  - `POST /api/v1/runs/:runId/events`
  - `GET /api/v1/insights`
  - `GET /api/v1/runs`
  - `GET /api/v1/runs/:runId`
  - `GET /api/v1/runs/:runId/stream`

## Multi-Tenant Runtime APIs (v2)

- Execution contexts:
  - `POST /api/v2/execution-contexts`
  - `POST /api/v2/execution-contexts/:id/revoke`
- Agent runs with execution context:
  - `POST /api/v2/agent-runs/chat`
  - `POST /api/v2/agent-runs/chat/stream`
- Connected applications (platform admin):
  - `GET /api/v2/applications`
  - `POST /api/v2/applications`
- MCP gateways (platform admin):
  - `GET /api/v2/mcp/gateways`
  - `POST /api/v2/mcp/gateways`
  - `PUT /api/v2/mcp/gateways/:id`
  - `DELETE /api/v2/mcp/gateways/:id`
- Tool policies (platform admin):
  - `GET /api/v2/mcp/tool-policies`
  - `POST /api/v2/mcp/tool-policies`
  - `PUT /api/v2/mcp/tool-policies/:id`
  - `DELETE /api/v2/mcp/tool-policies/:id`

## MCP Endpoints

- Generic SSE: `GET /mcp/sse` + `POST /mcp/messages`
- Tool-scoped SSE: `GET /mcp/tool/:exposedName/sse`
- Bundle-scoped SSE: `GET /mcp/bundle/:slug/sse`
- Manifest: `GET /mcp/manifest`
- Direct tool call: `POST /mcp/call/:toolName`

## Platform Ingestion API

Create run:
```bash
curl -X POST http://localhost:3000/api/v1/runs \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"agent_run","name":"my run"}'
```

Append events:
```bash
curl -X POST http://localhost:3000/api/v1/runs/<RUN_ID>/events \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"type":"llm_call","name":"chat","attributes":{"llm":{"prompt_tokens":10,"completion_tokens":20,"cost_usd":0.001}}}]}'
```

## Troubleshooting

- `Invalid credentials` after reseed: run `npm run seed` again or `npm run reset-password`.
- Postgres errors: verify `docker ps` and `DATABASE_URL`.
- MCP 400 on connect: use correct transport URL (`/mcp/sse` for SSE clients, `/mcp` base for streamable HTTP clients).
- Agent chat slow at `Preparing tools and execution context...`: tune MCP cache/prewarm env vars and verify `tool_prep.*` span attributes for cache hits and endpoint counts.
- If tests warn about `whileHover` in UI tests: this comes from motion mocks and is non-blocking.

## Deployment Guide

### Option A: Single VM (recommended first production rollout)

1. Install Node 20+, npm, Docker.
2. Clone repo and create `.env`.
3. Run Postgres with:
```bash
npm run db:up
```
4. Run DB setup:
```bash
npm run prisma:generate
npm run prisma:migrate
```
5. Build frontend:
```bash
npm run build
```
6. Start app process:
```bash
NODE_ENV=production npm run dev
```
7. Put behind Nginx/Caddy reverse proxy with HTTPS.

Note: current app serves Vite middleware in non-production mode. If you want strict production static serving, add an Express static handler for `dist/`.

### Option B: Containerized

- Use app container + Postgres container.
- Mount persistent volumes for:
  - `orchestrator.db` (SQLite)
  - Postgres data
- Set env vars from secrets manager (not plaintext in image).
- Add health checks for app and database.

### Option C: Cloud Run + GCS + Redis (recommended for your setup)

1. Build and push image:
```bash
gcloud builds submit --tag gcr.io/<PROJECT_ID>/agentic-orchestrator
```
2. Create a bucket for SQLite snapshots:
```bash
gsutil mb -l <REGION> gs://<SQLITE_BUCKET>
```
3. Provision Redis (Memorystore) and copy its `REDIS_URL`.
4. Deploy Cloud Run:
```bash
gcloud run deploy agentic-orchestrator \
  --image gcr.io/<PROJECT_ID>/agentic-orchestrator \
  --region <REGION> \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,SQLITE_PATH=/tmp/orchestrator/orchestrator.db,GCS_SQLITE_BUCKET=<SQLITE_BUCKET>,GCS_SQLITE_PREFIX=state,GCS_SYNC_INTERVAL_MS=30000,REDIS_URL=redis://<REDIS_HOST>:6379,EXECUTION_CONTEXT_TOKEN_AUDIENCE=agentic-orchestrator,DELEGATED_TOOL_TOKEN_AUDIENCE=app-mcp-gateway,MCP_MANIFEST_CACHE_TTL_MS=180000,MCP_MANIFEST_PREWARM_ENABLED=true,MCP_MANIFEST_PREWARM_INTERVAL_MS=45000,MCP_MANIFEST_PREWARM_MAX_ENDPOINTS=80
```
5. Grant service account storage access:
```bash
gsutil iam ch serviceAccount:<CLOUD_RUN_SA>:roles/storage.objectAdmin gs://<SQLITE_BUCKET>
```

How it works in Cloud Run:
- On startup, `npm run start:cloudrun` restores SQLite artifacts from GCS into `/tmp`.
- During runtime, it periodically checkpoints and syncs SQLite (`.db`, `-wal`, `-shm`) back to GCS.
- On shutdown, app performs a final SQLite sync before process exit.

### Production Checklist

- Set strong `APP_SECRET`.
- Set strong `EXECUTION_CONTEXT_TOKEN_SECRET`.
- Set strong `DELEGATED_TOOL_TOKEN_SECRET`.
- Restrict CORS/origins at proxy layer.
- Use managed Postgres in production.
- Use managed Redis (Memorystore) in production.
- Enable regular DB backups.
- Rotate API keys periodically.
- Configure log retention and monitoring.
