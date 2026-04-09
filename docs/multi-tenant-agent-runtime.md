# Multi-Tenant Agent Runtime HLD/LLD

## Goal

This document defines how to evolve this repository into a scalable agent-running platform where:

- the orchestrator runs agents, queues jobs, streams chat, and records traces
- application platforms keep their own MCP servers close to business APIs and secrets
- user- and tenant-scoped actions are enforced by the application platform at tool execution time
- the frontend can chat with agents through the application layer while the agent itself runs in the orchestrator

The design assumes both the orchestrator and the application platforms must scale horizontally.

## Current Repo Baseline

The current repository already provides several useful building blocks:

- org/session auth in Postgres via `Org`, `User`, `Session`, and `Project`
- project API keys for ingestion in `ProjectApiKey`
- orchestrator projects, agents, tools, MCP bundles, executions, and agent sessions
- agent chat endpoints already scoped through `req.user.orgId`
- a local access-control subsystem for resource ownership and sharing

Relevant current files:

- `server.ts`
- `src/platform/auth.ts`
- `src/platform/routes.ts`
- `src/server/orchestratorAccess.ts`
- `src/server/registerOrchestratorConfigRoutes.ts`
- `prisma/schema.prisma`

## Problem Statement

The current architecture is close to what we need, but not enough for true multi-tenant delegated MCP execution.

Current gaps:

- credentials are effectively shared and platform-admin managed
- orchestrator resource access metadata still depends on local SQLite
- tool execution does not yet have a first-class delegated execution context
- the application platform is not yet modeled as the source of truth for user-scoped MCP authorization
- there is no short-lived impersonation or delegation token model between app backend and orchestrator

## Target Architecture

Use a control-plane and data-plane split.

### Control Plane: Orchestrator

The orchestrator owns:

- agent definitions
- crew/workflow definitions
- run lifecycle
- job queueing
- chat state
- memory/session state
- traces and observability
- global policy and quotas

The orchestrator does not own:

- raw end-user secrets
- long-lived tenant integration secrets
- final authorization decisions for application business actions

### Data Plane: Application MCP Gateway

Each application platform owns:

- user authentication
- tenant resolution
- RBAC and resource-level authorization
- secret storage and rotation
- API access to internal services
- MCP servers or MCP gateway endpoints

The application MCP gateway is the only system that can convert a delegated execution request into a real business action.

## High-Level Request Flow

### 1. Chat Entry

1. User chats in the application frontend.
2. Frontend sends the message to the application backend.
3. Application backend authenticates the user and resolves:
   - `org_id`
   - `tenant_id`
   - `user_id`
   - `project_id`
   - `conversation_id`
   - `allowed_agent_ids`
   - `allowed_tool_scopes`
   - `credential_refs`
4. Application backend mints a short-lived execution-context token.
5. Application backend calls the orchestrator chat/run API.

### 2. Agent Execution

1. Orchestrator validates the application-issued token.
2. Orchestrator creates or resumes an agent session.
3. Orchestrator enqueues execution under a tenant-scoped concurrency bucket.
4. Agent runs normally.
5. When a tool call is needed, the orchestrator routes it to an application MCP endpoint using the delegated tool token.

### 3. MCP Execution

1. Application MCP gateway validates the delegated tool token.
2. Gateway re-checks user, tenant, scope, and resource permissions.
3. Gateway resolves local secrets using `credential_ref` values.
4. Gateway calls internal application APIs.
5. Gateway returns the tool result to the orchestrator.

### 4. Streaming

1. Orchestrator publishes status/events.
2. Application backend may either:
   - proxy orchestrator SSE/WebSocket streams to the frontend
   - or let the frontend connect to orchestrator with an app-signed session token
3. Frontend renders messages and tool progress.

## Trust Boundaries

### Browser

- untrusted
- carries app session only

### Application Backend

- trusted for end-user identity
- trusted for tenant resolution
- trusted to mint short-lived delegated execution tokens

### Orchestrator

- trusted to run LLM and workflow logic
- trusted to enforce coarse access and quota checks
- not trusted to hold long-lived user secrets

### MCP Gateway

- trusted to perform final authorization and secret resolution
- trusted to call business APIs

## Core Principle

Never store raw user OAuth tokens or long-lived tenant API secrets inside the orchestrator persistence layer.

The orchestrator stores:

- identity claims
- tenant claims
- allowed tool scopes
- credential references
- session and run metadata
- hashes or references to delegated tokens

The application platform stores:

- raw tenant secrets
- raw user delegated tokens
- rotation metadata
- provider refresh tokens

## New Domain Concepts

Add these concepts to the system:

### Application

Represents an external product or website connected to the orchestrator.

### Tenant

Represents the business tenant within an application platform. In some products this may map to `org`, `workspace`, or `account`.

### Execution Context

Represents the app-authenticated actor and authorization envelope for a run. This is the core bridge between app backend and orchestrator.

### Credential Reference

Represents a pointer to a secret held by the application platform, not the secret itself.

### MCP Gateway Registration

Represents a remote MCP server or gateway owned by an application platform and trusted by the orchestrator for delegated tool execution.

## Proposed Data Model

These models should live in Postgres, not SQLite.

### New Prisma Models

```prisma
model ConnectedApplication {
  id             String   @id @default(uuid())
  name           String
  slug           String   @unique
  status         String   @default("active")
  baseUrl        String?  @map("base_url")
  jwksUrl        String?  @map("jwks_url")
  tokenIssuer    String   @map("token_issuer")
  tokenAudience  String   @map("token_audience")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  projects       Project[]
  mcpGateways    ApplicationMcpGateway[]
  executionContexts AgentExecutionContext[]

  @@map("connected_applications")
}

model ApplicationMcpGateway {
  id               String   @id @default(uuid())
  applicationId    String   @map("application_id")
  name             String
  endpointUrl      String   @map("endpoint_url")
  authMode         String   @default("signed_jwt") @map("auth_mode")
  status           String   @default("active")
  timeoutMs        Int      @default(15000) @map("timeout_ms")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  application      ConnectedApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([applicationId])
  @@map("application_mcp_gateways")
}

model AgentExecutionContext {
  id                 String   @id @default(uuid())
  applicationId      String   @map("application_id")
  orgId              String   @map("org_id")
  projectId          String?  @map("project_id")
  tenantExternalId   String   @map("tenant_external_id")
  userExternalId     String   @map("user_external_id")
  conversationId     String?  @map("conversation_id")
  sessionId          String?  @map("session_id")
  rolesJson          Json?    @map("roles_jsonb")
  scopesJson         Json?    @map("scopes_jsonb")
  allowedToolsJson   Json?    @map("allowed_tools_jsonb")
  credentialRefsJson Json?    @map("credential_refs_jsonb")
  sourceTokenJti     String?  @map("source_token_jti")
  status             String   @default("active")
  expiresAt          DateTime @map("expires_at")
  createdAt          DateTime @default(now()) @map("created_at")
  revokedAt          DateTime? @map("revoked_at")

  application        ConnectedApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  org                Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([applicationId, tenantExternalId])
  @@index([orgId, projectId])
  @@index([userExternalId])
  @@index([expiresAt])
  @@map("agent_execution_contexts")
}

model AgentCredentialBinding {
  id                  String   @id @default(uuid())
  executionContextId  String   @map("execution_context_id")
  provider            String
  credentialRef       String   @map("credential_ref")
  subjectType         String   @map("subject_type")
  subjectExternalId   String   @map("subject_external_id")
  scopesJson          Json?    @map("scopes_jsonb")
  createdAt           DateTime @default(now()) @map("created_at")

  @@index([executionContextId])
  @@index([provider, credentialRef])
  @@map("agent_credential_bindings")
}

model AgentToolPolicy {
  id                 String   @id @default(uuid())
  applicationId      String   @map("application_id")
  agentId            Int?     @map("agent_id")
  toolName           String   @map("tool_name")
  gatewayId          String   @map("gateway_id")
  requiredScopesJson Json?    @map("required_scopes_jsonb")
  enabled            Boolean  @default(true)
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@index([applicationId, toolName])
  @@index([agentId])
  @@map("agent_tool_policies")
}
```

## Changes to Existing Models

### `Project`

Add a relation to the originating application.

```prisma
applicationId String? @map("application_id")
```

This lets the orchestrator know which application minted context for a given project.

### `ProjectApiKey`

Extend project API keys to support machine-to-machine execution from application backends.

Add:

- `keyType` such as `internal`, `sdk`, `gateway`
- `expiresAt`
- `lastUsedIp`
- `allowedOriginsJson`

### `OrchestratorAgentSession`

Add:

- `executionContextId`
- `tenantExternalId`
- `userExternalId`
- `conversationId`

This makes session memory tenant-safe and user-aware.

### `OrchestratorToolExecution`

Add:

- `executionContextId`
- `gatewayId`
- `credentialRefsJson`
- `requestId`
- `idempotencyKey`
- `subjectUserExternalId`
- `subjectTenantExternalId`

These fields make audit and replay safe.

## Required API Contracts

### 1. Application Backend -> Orchestrator

Create or resume agent chat:

`POST /api/v2/agent-runs/chat`

Request:

```json
{
  "agent_id": 42,
  "message": "Create a lead for Acme",
  "session_id": "chat_s_123",
  "conversation_id": "conv_123",
  "context_token": "<short-lived JWT>",
  "attachments": []
}
```

Behavior:

- validate `context_token`
- materialize `AgentExecutionContext`
- enforce agent visibility for the mapped tenant/org
- enqueue under tenant key
- stream or return output

### 2. Application Backend -> Orchestrator

Optional explicit context pre-registration:

`POST /api/v2/execution-contexts`

Request:

```json
{
  "project_id": "uuid",
  "tenant_external_id": "tenant_001",
  "user_external_id": "user_999",
  "conversation_id": "conv_123",
  "session_id": "chat_s_123",
  "roles": ["sales_rep"],
  "scopes": ["crm.leads:write"],
  "allowed_tools": ["crm.create_lead"],
  "credential_refs": ["salesforce:tenant_001", "hubspot:user_999"],
  "expires_at": "2026-04-09T12:00:00.000Z"
}
```

Response:

```json
{
  "execution_context_id": "ctx_uuid",
  "expires_at": "2026-04-09T12:00:00.000Z"
}
```

### 3. Orchestrator -> Application MCP Gateway

Tool invocation:

`POST /mcp/gateway/tool-call`

Headers:

- `Authorization: Bearer <delegated_tool_token>`
- `X-Orchestrator-Request-Id: <uuid>`
- `X-Orchestrator-Execution-Id: <id>`
- `Idempotency-Key: <uuid>`

Request:

```json
{
  "tool_name": "crm.create_lead",
  "arguments": {
    "name": "Acme",
    "email": "ops@acme.com"
  },
  "context": {
    "execution_context_id": "ctx_uuid",
    "tenant_external_id": "tenant_001",
    "user_external_id": "user_999",
    "session_id": "chat_s_123",
    "conversation_id": "conv_123",
    "credential_refs": ["salesforce:tenant_001"]
  }
}
```

### 4. Application MCP Gateway -> Orchestrator

Tool result:

```json
{
  "ok": true,
  "output": {
    "lead_id": "sf_123",
    "status": "created"
  },
  "audit": {
    "provider": "salesforce",
    "subject_type": "user",
    "subject_id": "user_999"
  }
}
```

## Token Design

Use two token types.

### A. Execution Context Token

Minted by the application backend. Consumed by the orchestrator.

Properties:

- JWT
- signed by application private key
- verified by orchestrator using application JWKS
- short TTL, ideally 5 to 15 minutes
- single audience: orchestrator

Claims:

```json
{
  "iss": "https://app.example.com",
  "aud": "agentic-orchestrator",
  "sub": "user:user_999",
  "app_id": "app_uuid",
  "org_id": "org_uuid",
  "project_id": "project_uuid",
  "tenant_external_id": "tenant_001",
  "user_external_id": "user_999",
  "conversation_id": "conv_123",
  "session_id": "chat_s_123",
  "roles": ["sales_rep"],
  "scopes": ["crm.leads:write"],
  "allowed_tools": ["crm.create_lead"],
  "credential_refs": ["salesforce:tenant_001"],
  "jti": "jwt_id",
  "exp": 1770000000
}
```

### B. Delegated Tool Token

Minted by the orchestrator. Consumed by the application MCP gateway.

Properties:

- JWT
- signed by orchestrator
- verified by application gateway using orchestrator JWKS or shared signing key
- very short TTL, ideally 30 to 120 seconds
- narrow audience: the specific MCP gateway

Claims:

```json
{
  "iss": "agentic-orchestrator",
  "aud": "app-mcp-gateway",
  "sub": "tool:crm.create_lead",
  "execution_context_id": "ctx_uuid",
  "tenant_external_id": "tenant_001",
  "user_external_id": "user_999",
  "allowed_tool": "crm.create_lead",
  "credential_refs": ["salesforce:tenant_001"],
  "required_scopes": ["crm.leads:write"],
  "request_id": "req_uuid",
  "jti": "tool_jwt_id",
  "exp": 1770000000
}
```

## Authorization Model

Authorization is enforced in three layers.

### Layer 1: Application Backend

Decides whether the actor is allowed to talk to the requested agent at all.

Checks:

- user is authenticated
- user belongs to the tenant
- tenant is linked to the requested project/app
- user is allowed to use the selected agent

### Layer 2: Orchestrator

Decides whether the run and tool selection are compatible with platform policy.

Checks:

- project belongs to org
- tenant/application mapping exists
- agent is available for that tenant/project
- tool is enabled for the agent
- quotas/concurrency are not exceeded

### Layer 3: MCP Gateway

Makes the final business authorization decision.

Checks:

- delegated tool token is valid and unexpired
- tool name matches allowed tool
- user/tenant still has permission
- credential ref is valid and active
- resource-level checks pass

The MCP gateway must be authoritative for final business actions.

## Credential Strategy

Replace the current shared credential pattern with three scopes:

### Shared Platform Credential

Use for orchestrator-owned services only:

- LLM providers
- observability providers
- platform-wide internal services

### Tenant Credential

Use for tenant-level integrations:

- CRM tenant connections
- billing tenant API keys
- support desk tenant secrets

The application stores the raw secret. The orchestrator stores only `credential_ref`.

### User Credential

Use for end-user delegated actions:

- user OAuth access token
- user OAuth refresh token
- user-scoped SaaS authorization

Again, keep the raw token in the application platform.

## Queueing and Scalability

### Queue Partitioning

All execution queues should partition by:

- `org_id`
- `tenant_external_id`
- priority

This prevents a noisy tenant from starving others.

### Concurrency Controls

Enforce:

- per-user active chat limit
- per-tenant active run limit
- per-tenant tool-call QPS
- per-gateway circuit breaker

### Stateless API Tier

Separate:

- API/web nodes
- worker nodes
- MCP gateway nodes

Do not keep execution-critical state only in memory.

### Storage Rules

Use Postgres for:

- execution contexts
- session mappings
- tool audit rows
- access policies
- gateway registrations

Use Redis or equivalent for:

- queue dispatch
- distributed locks
- ephemeral rate-limits
- stream fanout state

## Observability and Audit

Every run and tool call should carry:

- `application_id`
- `org_id`
- `tenant_external_id`
- `user_external_id`
- `execution_context_id`
- `request_id`
- `gateway_id`
- `credential_refs`

Add audit records for:

- context created
- context revoked
- delegated tool token minted
- tool call attempted
- tool call allowed/denied
- credential ref resolution result

## Changes Required in This Repo

### 1. Move access control out of SQLite

Current local-only ownership tables in `src/server/orchestratorAccess.ts` should move to Postgres as a unit.

Why:

- current SQLite ownership/share metadata will not scale across replicas
- access checks for credentials, bundles, tools, and voices should be durable and shared

### 2. Replace shared credential management

Current routes in `src/server/registerOrchestratorConfigRoutes.ts` only allow platform-admin managed shared credentials.

Replace with:

- credential references in orchestrator
- tenant/user-scoped credential descriptors
- no raw secret persistence in orchestrator for app-owned integrations

### 3. Add v2 chat/run entrypoints

Current `POST /api/agents/:id/chat` and `/stream` are session-driven.

Add new v2 endpoints that accept:

- `context_token`
- `conversation_id`
- `session_id`
- optional `execution_context_id`

Keep current routes for backward compatibility.

### 4. Add execution-context persistence

Persist the application-issued execution envelope before job enqueue.

This gives downstream workers a stable, revocable context record.

### 5. Add remote MCP gateway registry

Current MCP support is oriented around local tool exposure and package execution.

Add support for:

- registered application gateways
- remote per-tool routing
- delegated tool token minting
- signed outbound calls

### 6. Extend tool execution audit

Store context-aware tool execution metadata in `OrchestratorToolExecution`.

### 7. Add explicit application identity

Link `Project` to a `ConnectedApplication` record so all downstream policy can resolve through application ownership.

## Suggested Implementation Phases

### Phase 1: Foundation

- add Prisma models for `ConnectedApplication`, `ApplicationMcpGateway`, `AgentExecutionContext`, `AgentToolPolicy`
- add project-to-application linkage
- add new indexes for tenant-scoped lookup
- keep current chat and MCP runtime behavior unchanged

### Phase 2: Execution Context

- add context-token verification
- add `POST /api/v2/execution-contexts`
- add `POST /api/v2/agent-runs/chat`
- persist `AgentExecutionContext`
- attach `execution_context_id` to queued jobs

### Phase 3: Remote MCP Gateways

- register remote application MCP gateways
- add delegated tool token minting
- route selected tools through remote gateway calls
- add audit metadata for remote tool execution

### Phase 4: Credential Ref Migration

- replace raw app-owned credentials in orchestrator with `credential_ref`
- preserve current shared credentials only for platform-owned services
- add migration path for existing tool configs

### Phase 5: Access-Control Migration

- move `resource_owners` and `resource_shares` to Postgres
- update `resolveOrchestratorAccessScope`
- remove runtime dependence on local SQLite access metadata

### Phase 6: Horizontal Scale Hardening

- move any remaining in-memory queue/session assumptions to Redis or durable worker coordination
- add per-tenant quotas and breaker policies
- add gateway health checks and fail-open/fail-closed policy per tool

## Endpoint Compatibility Strategy

Keep the current API intact while adding v2 behavior.

### Keep

- `/api/agents/:id/chat`
- `/api/agents/:id/chat/stream`
- `/api/v1/runs`
- `/api/v1/runs/:runId/events`

### Add

- `/api/v2/execution-contexts`
- `/api/v2/execution-contexts/:id/revoke`
- `/api/v2/agent-runs/chat`
- `/api/v2/agent-runs/chat/stream`
- `/api/v2/mcp/gateways`
- `/api/v2/mcp/tool-policies`

## Failure Handling Rules

### If execution context token is expired

- reject before enqueue
- return `401` or `403`

### If delegated tool token expires during retry

- orchestrator should mint a fresh token for the retry

### If app gateway is down

- surface tool failure in run events
- obey tool policy for retry/backoff
- do not bypass to internal API directly

### If tenant credential is revoked

- app MCP gateway returns authorization failure
- orchestrator records a structured tool failure
- optionally mark context stale if repeated failures occur

## Security Rules

- raw user credentials never leave the application trust boundary
- delegated tokens must be short-lived
- all JWTs must include `jti` for replay detection
- outbound orchestrator-to-gateway requests must include idempotency keys
- every tool execution must be auditable to tenant and user
- final authorization always happens in the application MCP gateway

## Concrete Repo Follow-Ups

These are the first code changes to make in this repository:

1. Add Prisma models and migration for:
   - `ConnectedApplication`
   - `ApplicationMcpGateway`
   - `AgentExecutionContext`
   - `AgentToolPolicy`
2. Add a new module such as `src/platform/executionContext.ts` for:
   - context token verification
   - context persistence
   - revocation checks
3. Add a new module such as `src/server/remoteMcpGateway.ts` for:
   - gateway lookup
   - delegated tool token minting
   - signed HTTP tool calls
4. Add `v2` chat routes and thread `execution_context_id` through queue payloads
5. Extend tool execution records and traces with tenant/user/application fields
6. Migrate SQLite access metadata into Postgres before multi-node production rollout

## Recommended First Slice

Implement the smallest useful vertical slice in this order:

1. `ConnectedApplication`
2. `AgentExecutionContext`
3. `POST /api/v2/agent-runs/chat`
4. thread `execution_context_id` into queued jobs and `OrchestratorAgentSession`
5. support one remote MCP gateway for one application-owned tool family

That gets the architecture working end to end before broader migration.
