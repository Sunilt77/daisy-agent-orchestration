import { PrismaClient } from '@prisma/client';

let prismaSingleton: PrismaClient | undefined;
let schemaReadyPromise: Promise<void> | undefined;

async function ensureSchemaCompatibility(prisma: PrismaClient) {
  const statements = [
    `ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS project_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS project_api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`,
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
    `ALTER TABLE IF EXISTS orchestrator_agent_session_memory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE IF EXISTS orchestrator_workflow_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
  }
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
