import { PrismaClient } from '@prisma/client';

let prismaSingleton: PrismaClient | undefined;
let schemaReadyPromise: Promise<void> | undefined;

async function ensureSchemaCompatibility(prisma: PrismaClient) {
  const statements = [
    `ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS project_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS project_api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS application_id TEXT`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS environment TEXT`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS release TEXT`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS trace_id TEXT`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS parent_run_id TEXT`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS tags_jsonb JSONB`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS error_jsonb JSONB`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS runs ADD COLUMN IF NOT EXISTS total_cost_usd DECIMAL(18, 6) DEFAULT 0.0`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS span_id TEXT`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS parent_span_id TEXT`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS name TEXT`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS status TEXT`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS input_text TEXT`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS output_text TEXT`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS error_jsonb JSONB`,
    `ALTER TABLE IF EXISTS run_events ADD COLUMN IF NOT EXISTS attributes_jsonb JSONB`,
    `ALTER TABLE IF EXISTS orchestrator_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_projects ADD COLUMN IF NOT EXISTS platform_project_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_project_links ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_project_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS project_id INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS is_exposed BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS max_runtime_ms INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS max_cost_usd DOUBLE PRECISION`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS max_tool_calls INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_crews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_workflows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_workflows ADD COLUMN IF NOT EXISTS project_id INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_workflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_workflow_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_credentials ADD COLUMN IF NOT EXISTS key_name TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_credentials ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general'`,
    `ALTER TABLE IF EXISTS orchestrator_credentials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_credentials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_llm_providers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_llm_providers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_tools ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_tool_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_tools ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_tools ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_crew_agents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_crew_agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_exposed_tools ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_exposed_tools ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundles ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundles ADD COLUMN IF NOT EXISTS is_exposed BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_exposed_tool_versions ADD COLUMN IF NOT EXISTS is_exposed BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_exposed_tool_versions ADD COLUMN IF NOT EXISTS change_kind TEXT DEFAULT 'update'`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_exposed_tool_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundle_versions ADD COLUMN IF NOT EXISTS tool_ids TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundle_versions ADD COLUMN IF NOT EXISTS change_kind TEXT DEFAULT 'update'`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundle_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundle_tools ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_mcp_bundle_tools ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_mcp_tools ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_mcp_tools ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_mcp_bundles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_mcp_bundles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_executions ADD COLUMN IF NOT EXISTS execution_kind TEXT DEFAULT 'standard'`,
    `ALTER TABLE IF EXISTS orchestrator_agent_executions ADD COLUMN IF NOT EXISTS parent_execution_id INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_agent_executions ADD COLUMN IF NOT EXISTS delegation_title TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_agent_executions ADD COLUMN IF NOT EXISTS task TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_agent_executions ADD COLUMN IF NOT EXISTS retry_of INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_agent_delegations ADD COLUMN IF NOT EXISTS child_execution_id INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_agent_delegations ADD COLUMN IF NOT EXISTS child_job_id INTEGER`,
    `ALTER TABLE IF EXISTS orchestrator_agent_delegations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_crew_executions ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS orchestrator_crew_executions ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS orchestrator_crew_executions ADD COLUMN IF NOT EXISTS total_cost DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE IF EXISTS orchestrator_agent_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_agent_sessions ADD COLUMN IF NOT EXISTS execution_context_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_agent_sessions ADD COLUMN IF NOT EXISTS tenant_external_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_agent_sessions ADD COLUMN IF NOT EXISTS user_external_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_agent_sessions ADD COLUMN IF NOT EXISTS conversation_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_agent_session_memory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS execution_context_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS gateway_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS request_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS credential_refs_jsonb JSONB`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS subject_user_external_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_tool_executions ADD COLUMN IF NOT EXISTS subject_tenant_external_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_workflow_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS worker_id TEXT`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 100`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_job_queue ADD COLUMN IF NOT EXISTS tenant_key TEXT DEFAULT 'global'`,
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS connected_applications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      base_url TEXT,
      jwks_url TEXT,
      token_issuer TEXT NOT NULL,
      token_audience TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS application_mcp_gateways (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES connected_applications(id) ON DELETE CASCADE ON UPDATE CASCADE,
      name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'signed_jwt',
      status TEXT NOT NULL DEFAULT 'active',
      timeout_ms INTEGER NOT NULL DEFAULT 15000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_execution_contexts (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES connected_applications(id) ON DELETE CASCADE ON UPDATE CASCADE,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE ON UPDATE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL ON UPDATE CASCADE,
      tenant_external_id TEXT NOT NULL,
      user_external_id TEXT NOT NULL,
      conversation_id TEXT,
      session_id TEXT,
      roles_jsonb JSONB,
      scopes_jsonb JSONB,
      allowed_tools_jsonb JSONB,
      credential_refs_jsonb JSONB,
      source_token_jti TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_credential_bindings (
      id TEXT PRIMARY KEY,
      execution_context_id TEXT NOT NULL REFERENCES agent_execution_contexts(id) ON DELETE CASCADE ON UPDATE CASCADE,
      provider TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_external_id TEXT NOT NULL,
      scopes_jsonb JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_tool_policies (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES connected_applications(id) ON DELETE CASCADE ON UPDATE CASCADE,
      agent_id INTEGER REFERENCES orchestrator_agents(id) ON DELETE SET NULL ON UPDATE CASCADE,
      tool_name TEXT NOT NULL,
      gateway_id TEXT NOT NULL REFERENCES application_mcp_gateways(id) ON DELETE CASCADE ON UPDATE CASCADE,
      required_scopes_jsonb JSONB,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE orchestrator_projects p
    SET platform_project_id = l.platform_project_id
    FROM orchestrator_project_links l
    WHERE l.project_id = p.id
      AND (p.platform_project_id IS NULL OR p.platform_project_id = '')
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS projects_application_id_idx
    ON projects (application_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS application_mcp_gateways_application_id_idx
    ON application_mcp_gateways (application_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_execution_contexts_application_id_tenant_external_id_idx
    ON agent_execution_contexts (application_id, tenant_external_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_execution_contexts_org_id_project_id_idx
    ON agent_execution_contexts (org_id, project_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_execution_contexts_user_external_id_idx
    ON agent_execution_contexts (user_external_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_execution_contexts_expires_at_idx
    ON agent_execution_contexts (expires_at)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_credential_bindings_execution_context_id_idx
    ON agent_credential_bindings (execution_context_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_credential_bindings_provider_credential_ref_idx
    ON agent_credential_bindings (provider, credential_ref)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_tool_policies_application_id_tool_name_idx
    ON agent_tool_policies (application_id, tool_name)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_tool_policies_agent_id_idx
    ON agent_tool_policies (agent_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_tool_policies_gateway_id_idx
    ON agent_tool_policies (gateway_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS orchestrator_tool_executions_execution_context_id_idx
    ON orchestrator_tool_executions (execution_context_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS orchestrator_tool_executions_gateway_id_idx
    ON orchestrator_tool_executions (gateway_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS orchestrator_agent_sessions_execution_context_id_idx
    ON orchestrator_agent_sessions (execution_context_id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS orchestrator_job_queue_status_ready_priority_idx
    ON orchestrator_job_queue (status, ready_at, priority DESC, id)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS orchestrator_job_queue_status_ready_tenant_priority_idx
    ON orchestrator_job_queue (status, ready_at, tenant_key, priority DESC, id)
  `);
}

export function getPrisma() {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
    schemaReadyPromise = ensureSchemaCompatibility(prismaSingleton).catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }
  return prismaSingleton;
}

export async function ensurePrismaReady() {
  const prisma = getPrisma();
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchemaCompatibility(prisma).catch((error) => {
      schemaReadyPromise = undefined;
      throw error;
    });
  }
  await schemaReadyPromise;
  return prisma;
}

export async function closePrisma() {
  await schemaReadyPromise?.catch(() => undefined);
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = undefined;
  }
  schemaReadyPromise = undefined;
}
