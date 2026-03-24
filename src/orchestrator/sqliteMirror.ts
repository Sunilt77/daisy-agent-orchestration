import db from '../db';
import { getPrisma } from '../platform/prisma';

function json(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function ts(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function syncPersistentMirrorFromPostgres() {
  const prisma = getPrisma();
  const [
    settings,
    projects,
    projectLinks,
    credentials,
    llmProviders,
    tools,
    toolVersions,
    mcpExposedTools,
    mcpBundles,
    mcpExposedToolVersions,
    mcpBundleVersions,
    mcpBundleTools,
    agents,
    agentTools,
    agentMcpTools,
    agentMcpBundles,
    crews,
    crewAgents,
    tasks,
    workflows,
    workflowVersions,
  ] = await Promise.all([
    prisma.orchestratorSetting.findMany({ orderBy: { key: 'asc' } }),
    prisma.orchestratorProject.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorProjectLink.findMany({ orderBy: { projectId: 'asc' } }),
    prisma.orchestratorCredential.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorLlmProvider.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorTool.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorToolVersion.findMany({ orderBy: [{ toolId: 'asc' }, { versionNumber: 'asc' }] }),
    prisma.orchestratorMcpExposedTool.findMany({ orderBy: { toolId: 'asc' } }),
    prisma.orchestratorMcpBundle.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorMcpExposedToolVersion.findMany({ orderBy: [{ toolId: 'asc' }, { versionNumber: 'asc' }] }),
    prisma.orchestratorMcpBundleVersion.findMany({ orderBy: [{ bundleId: 'asc' }, { versionNumber: 'asc' }] }),
    prisma.orchestratorMcpBundleTool.findMany({ orderBy: [{ bundleId: 'asc' }, { toolId: 'asc' }] }),
    prisma.orchestratorAgent.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorAgentTool.findMany({ orderBy: [{ agentId: 'asc' }, { toolId: 'asc' }] }),
    prisma.orchestratorAgentMcpTool.findMany({ orderBy: [{ agentId: 'asc' }, { toolId: 'asc' }] }),
    prisma.orchestratorAgentMcpBundle.findMany({ orderBy: [{ agentId: 'asc' }, { bundleId: 'asc' }] }),
    prisma.orchestratorCrew.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorCrewAgent.findMany({ orderBy: [{ crewId: 'asc' }, { agentId: 'asc' }] }),
    prisma.orchestratorTask.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorWorkflow.findMany({ orderBy: { id: 'asc' } }),
    prisma.orchestratorWorkflowVersion.findMany({ orderBy: [{ workflowId: 'asc' }, { versionNumber: 'asc' }] }),
  ]);

  db.pragma('foreign_keys = OFF');
  const syncTx = db.transaction(() => {
    try {
      for (const table of [
        'agent_mcp_bundles',
        'agent_mcp_tools',
        'mcp_bundle_tools',
        'mcp_bundle_versions',
        'mcp_exposed_tool_versions',
        'mcp_bundles',
        'mcp_exposed_tools',
        'tasks',
        'crew_agents',
        'crews',
        'agent_tools',
        'agents',
        'tool_versions',
        'tools',
        'llm_providers',
        'credentials',
        'workflow_versions',
        'workflows',
        'project_links',
        'projects',
        'settings',
      ]) {
        db.prepare(`DELETE FROM ${table}`).run();
      }

      const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const row of settings) insertSetting.run(row.key, row.value);

      const insertProject = db.prepare('INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)');
      for (const row of projects) insertProject.run(row.id, row.name, row.description ?? null, ts(row.createdAt));

      const insertProjectLink = db.prepare('INSERT INTO project_links (project_id, platform_project_id, created_at, updated_at) VALUES (?, ?, ?, ?)');
      for (const row of projectLinks) {
        insertProjectLink.run(row.projectId, row.platformProjectId, ts(row.createdAt), ts(row.updatedAt));
      }

      const insertCredential = db.prepare('INSERT INTO credentials (id, provider, name, key_name, category, api_key) VALUES (?, ?, ?, ?, ?, ?)');
      for (const row of credentials) {
        insertCredential.run(row.id, row.provider, row.name ?? null, row.keyName ?? null, row.category, row.apiKey);
      }

      const insertProvider = db.prepare('INSERT INTO llm_providers (id, name, provider, api_base, api_key, is_default) VALUES (?, ?, ?, ?, ?, ?)');
      for (const row of llmProviders) {
        insertProvider.run(row.id, row.name, row.provider, row.apiBase ?? null, row.apiKey ?? null, row.isDefault ? 1 : 0);
      }

      const insertTool = db.prepare('INSERT INTO tools (id, name, description, category, type, config, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of tools) {
        insertTool.run(row.id, row.name, row.description, row.category, row.type, row.config ?? null, row.version, ts(row.updatedAt));
      }

      const insertToolVersion = db.prepare('INSERT INTO tool_versions (id, tool_id, version_number, name, description, category, type, config, change_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of toolVersions) {
        insertToolVersion.run(row.id, row.toolId, row.versionNumber, row.name, row.description, row.category, row.type, row.config ?? null, row.changeKind, ts(row.createdAt));
      }

      const insertMcpExposedTool = db.prepare('INSERT INTO mcp_exposed_tools (tool_id, exposed_name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      for (const row of mcpExposedTools) {
        insertMcpExposedTool.run(row.toolId, row.exposedName, row.description ?? null, ts(row.createdAt), ts(row.updatedAt));
      }

      const insertMcpBundle = db.prepare('INSERT INTO mcp_bundles (id, name, slug, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const row of mcpBundles) {
        insertMcpBundle.run(row.id, row.name, row.slug, row.description ?? null, ts(row.createdAt), ts(row.updatedAt));
      }

      const insertMcpExposedToolVersion = db.prepare('INSERT INTO mcp_exposed_tool_versions (id, tool_id, version_number, exposed_name, description, is_exposed, change_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of mcpExposedToolVersions) {
        insertMcpExposedToolVersion.run(row.id, row.toolId, row.versionNumber, row.exposedName ?? null, row.description ?? null, row.isExposed ? 1 : 0, row.changeKind, ts(row.createdAt));
      }

      const insertMcpBundleVersion = db.prepare('INSERT INTO mcp_bundle_versions (id, bundle_id, version_number, name, slug, description, tool_ids, change_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of mcpBundleVersions) {
        insertMcpBundleVersion.run(row.id, row.bundleId, row.versionNumber, row.name, row.slug, row.description ?? null, row.toolIds ?? null, row.changeKind, ts(row.createdAt));
      }

      const insertMcpBundleTool = db.prepare('INSERT INTO mcp_bundle_tools (bundle_id, tool_id, created_at) VALUES (?, ?, ?)');
      for (const row of mcpBundleTools) insertMcpBundleTool.run(row.bundleId, row.toolId, ts(row.createdAt));

      const insertAgent = db.prepare(`
        INSERT INTO agents (
          id, name, role, agent_role, status, goal, backstory, system_prompt, model, provider,
          temperature, max_tokens, memory_window, max_iterations, tools_enabled, retry_policy, timeout_ms,
          is_exposed, project_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of agents) {
        insertAgent.run(
          row.id,
          row.name,
          row.role,
          row.agentRole,
          row.status,
          row.goal,
          row.backstory ?? null,
          row.systemPrompt ?? null,
          row.model,
          row.provider,
          row.temperature ?? null,
          row.maxTokens ?? null,
          row.memoryWindow ?? null,
          row.maxIterations ?? null,
          row.toolsEnabled ? 1 : 0,
          row.retryPolicy ?? null,
          row.timeoutMs ?? null,
          row.isExposed ? 1 : 0,
          row.projectId ?? null,
        );
      }

      const insertAgentTool = db.prepare('INSERT INTO agent_tools (agent_id, tool_id) VALUES (?, ?)');
      for (const row of agentTools) insertAgentTool.run(row.agentId, row.toolId);

      const insertAgentMcpTool = db.prepare('INSERT INTO agent_mcp_tools (agent_id, tool_id, created_at) VALUES (?, ?, ?)');
      for (const row of agentMcpTools) insertAgentMcpTool.run(row.agentId, row.toolId, ts(row.createdAt));

      const insertAgentMcpBundle = db.prepare('INSERT INTO agent_mcp_bundles (agent_id, bundle_id, created_at) VALUES (?, ?, ?)');
      for (const row of agentMcpBundles) insertAgentMcpBundle.run(row.agentId, row.bundleId, ts(row.createdAt));

      const insertCrew = db.prepare(`
        INSERT INTO crews (
          id, name, process, coordinator_agent_id, project_id, is_exposed, description, max_runtime_ms, max_cost_usd, max_tool_calls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of crews) {
        insertCrew.run(
          row.id,
          row.name,
          row.process,
          row.coordinatorAgentId ?? null,
          row.projectId ?? null,
          row.isExposed ? 1 : 0,
          row.description ?? null,
          row.maxRuntimeMs ?? null,
          row.maxCostUsd ?? null,
          row.maxToolCalls ?? null,
        );
      }

      const insertCrewAgent = db.prepare('INSERT INTO crew_agents (crew_id, agent_id) VALUES (?, ?)');
      for (const row of crewAgents) insertCrewAgent.run(row.crewId, row.agentId);

      const insertTask = db.prepare('INSERT INTO tasks (id, description, expected_output, agent_id, crew_id, status, result) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const row of tasks) {
        insertTask.run(row.id, row.description, row.expectedOutput, row.agentId ?? null, row.crewId ?? null, row.status, row.result ?? null);
      }

      const insertWorkflow = db.prepare('INSERT INTO workflows (id, name, description, status, trigger_type, graph, version, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of workflows) {
        insertWorkflow.run(row.id, row.name, row.description ?? null, row.status, row.triggerType, row.graph, row.version, ts(row.updatedAt), row.projectId ?? null);
      }

      const insertWorkflowVersion = db.prepare('INSERT INTO workflow_versions (id, workflow_id, version_number, name, description, status, trigger_type, graph, change_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const row of workflowVersions) {
        insertWorkflowVersion.run(row.id, row.workflowId, row.versionNumber, row.name, row.description ?? null, row.status, row.triggerType, row.graph, row.changeKind, ts(row.createdAt));
      }
    } catch (e) {
      throw e;
    }
  });

  try {
    syncTx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export async function refreshPersistentMirror() {
  try {
    await syncPersistentMirrorFromPostgres();
  } catch (e) {
    console.error('Failed to refresh persistent mirror:', e);
  }
}
