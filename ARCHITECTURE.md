# Agentic Orchestrator Architecture

## Overview

This application is an agent orchestration platform with:

- a React/Vite frontend for building and operating agents, crews, tools, MCP bundles, traces, and platform governance
- an Express-based backend in `server.ts`
- PostgreSQL via Prisma as the durable system of record
- a local SQLite mirror used by legacy runtime paths, low-latency reads, and compatibility layers

The current architecture is intentionally hybrid while the system transitions from SQLite-first orchestration to Prisma/Postgres-first persistence.

## High-Level Design

### Frontend

Main UI responsibilities:

- Agent builder and agent operations
- Crew builder and task orchestration
- Tool builder, including HTTP and MCP tools
- MCP exposure and bundle management
- Trace and runtime observability
- Platform admin controls for tenant, plan, and access governance

Key paths:

- `src/pages/AgentsPage.tsx`
- `src/pages/CrewsPage.tsx`
- `src/pages/ToolsPage.tsx`
- `src/pages/McpPage.tsx`
- `src/pages/PlatformPage.tsx`

### Backend

Main backend responsibilities:

- CRUD APIs for orchestrator resources
- agent execution and delegation
- crew execution and workflow execution
- MCP exposure and compatibility endpoints
- platform governance APIs
- runtime status, streaming, and task control

Primary entrypoint:

- `server.ts`

### Persistence

There are two active persistence layers:

1. PostgreSQL via Prisma
   - durable store
   - primary source for platform state
   - increasingly the primary source for orchestrator state

2. SQLite mirror
   - compatibility with older orchestrator/runtime code
   - lightweight local reads and mirrored legacy tables

Relevant files:

- `prisma/schema.prisma`
- `src/platform/prisma.ts`
- `src/db.ts`
- `src/orchestrator/sqliteMirror.ts`

## Low-Level Design

### Durable Data Flow

Typical orchestrator write flow:

1. API route writes to Prisma/Postgres
2. route triggers `refreshPersistentMirror()`
3. SQLite mirror is updated from Postgres
4. runtime/legacy code can continue reading mirrored tables

### Runtime Execution

Runtime execution covers:

- direct agent runs
- delegated agent trees
- crew executions
- workflow executions
- queue-backed async jobs

Important runtime helpers:

- `src/orchestrator/runtimeStore.ts`
- queue usage in `server.ts`

### MCP Model

There are three MCP-related concepts:

1. Tools
   - regular orchestrator tools

2. Exposed MCP tools
   - specific tools marked as externally exposable

3. MCP bundles
   - grouped exposed tools attached to agents or exported externally

### Platform Governance

Platform governance sits above orchestrator features and controls:

- tenant visibility
- plan and limit enforcement
- tool/agent/MCP allowlisting
- project linkage

Relevant backend:

- `src/platform/routes.ts`

## Current Strengths

- Full end-to-end coverage across platform, orchestrator, runtime, and UI builders
- Durable Postgres schema with Prisma models for most orchestrator entities
- Backward compatibility via SQLite mirror
- Working test coverage for core CRUD, runtime, streaming, platform, and builder flows

## Current Constraints

### 1. `server.ts` is still monolithic

The backend currently combines:

- route registration
- runtime scheduling
- provider integration
- MCP handling
- admin APIs
- orchestration logic

This is functional but not ideal for long-term scalability or maintenance.

### 2. Hybrid persistence increases complexity

The Postgres + SQLite mirror approach is practical during migration, but it adds:

- mirror drift risk
- duplicate logic
- more complicated debugging

### 3. Runtime still depends on compatibility behavior

Some runtime and CRUD paths intentionally fall back to SQLite-backed reads or local compatibility checks when Postgres and the mirror are temporarily out of sync.

### 4. Access-control ownership is an intentional local subsystem

Resource ownership and sharing metadata currently live in SQLite-only tables:

- `resource_owners`
- `resource_shares`

This is intentionally isolated as a local access-control subsystem while core orchestrator execution state continues moving to Prisma/Postgres-first persistence.

Current behavior:

- runtime and orchestration state are Postgres-first
- ownership/share checks for local resources use SQLite
- cleanup of ownership/share rows is centralized in `src/server/orchestratorAccess.ts`

Migration note:

- if this subsystem is moved to Postgres, migrate as one unit (owner + shares + access resolution), not endpoint-by-endpoint
- until then, treat these tables as local-only access metadata rather than mirrored runtime state

## Scalability Recommendations

### Near Term

1. Split `server.ts` into modules:
   - `src/api/orchestrator/*`
   - `src/api/platform/*`
   - `src/runtime/*`
   - `src/mcp/*`
   - `src/providers/*`

2. Move more reads to Prisma-first access
   - keep SQLite only as mirror/compatibility layer

3. Centralize mirror synchronization policy
   - make mirror refresh behavior explicit and observable

4. Add route/service-level structured logging
   - especially around queueing, delegation, and MCP exposure

### Medium Term

1. Reduce or remove SQLite from runtime-critical paths
2. Introduce explicit job worker boundaries
3. Separate queue processing from API process for horizontal scale
4. Add stronger metrics around:
   - queue latency
   - agent execution duration
   - tool failure rate
   - MCP exposure sync errors

## Deployment Notes

For cloud deployment:

- PostgreSQL should be the authoritative store
- Redis or a managed queue is recommended if async job volume grows
- SQLite should not be treated as durable primary state in horizontally scaled deployments

## Validation Status

Current repository validation after the latest hardening pass:

- `npm run -s lint` passes
- `npm test` passes

This means the current HLD/LLD implementation is operational, but the next major architecture win is modularization plus continued reduction of SQLite-first runtime assumptions.
