import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { SQLITE_PATH, IS_MEMORY } from './platform/config';

if (!IS_MEMORY) {
  const SQLITE_DIR = path.dirname(SQLITE_PATH);
  fs.mkdirSync(SQLITE_DIR, { recursive: true });
}

const db = new Database(SQLITE_PATH);

export function isSqliteMemory() {
  return IS_MEMORY;
}

export function getSqlitePath() {
  return SQLITE_PATH;
}

export function checkpointSqlite(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE') {
  if (IS_MEMORY) return;
  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (e) {
    console.error('Migration error:', e);
    throw e;
  }
}

export function initDb() {
  if (!IS_MEMORY) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      platform_project_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_links (
      project_id INTEGER PRIMARY KEY,
      platform_project_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_role TEXT DEFAULT '',
      status TEXT DEFAULT 'idle', -- 'idle', 'running'
      goal TEXT NOT NULL,
      backstory TEXT,
      system_prompt TEXT,
      model TEXT DEFAULT 'gemini-1.5-flash',
      provider TEXT DEFAULT 'google',
      temperature REAL,
      max_tokens INTEGER,
      memory_window INTEGER,
      max_iterations INTEGER,
      tools_enabled BOOLEAN DEFAULT 1,
      retry_policy TEXT,
      timeout_ms INTEGER,
      is_exposed BOOLEAN DEFAULT 0,
      project_id INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS agent_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      status TEXT DEFAULT 'completed',
      execution_kind TEXT DEFAULT 'standard',
      parent_execution_id INTEGER,
      delegation_title TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0.0,
      input TEXT,
      output TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_delegations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_execution_id INTEGER NOT NULL,
      child_execution_id INTEGER,
      child_job_id INTEGER,
      agent_id INTEGER NOT NULL,
      role TEXT DEFAULT 'delegate',
      title TEXT,
      status TEXT DEFAULT 'queued',
      task TEXT,
      result TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_execution_id) REFERENCES agent_executions(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      process TEXT DEFAULT 'sequential',
      coordinator_agent_id INTEGER,
      FOREIGN KEY (coordinator_agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft',
      trigger_type TEXT DEFAULT 'manual',
      graph TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      project_id INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft',
      trigger_type TEXT DEFAULT 'manual',
      graph TEXT NOT NULL,
      change_kind TEXT DEFAULT 'update',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      status TEXT DEFAULT 'running',
      trigger_type TEXT DEFAULT 'manual',
      input TEXT,
      output TEXT,
      logs TEXT DEFAULT '[]',
      graph_snapshot TEXT,
      retry_of INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL UNIQUE, -- 'google', 'openai', 'anthropic'
      name TEXT,
      key_name TEXT,
      category TEXT DEFAULT 'general',
      api_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL, -- 'openai', 'google', 'anthropic', 'openai-compatible'
      api_base TEXT,
      api_key TEXT,
      is_default BOOLEAN DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      type TEXT DEFAULT 'custom', -- 'custom', 'search', 'calculator', etc.
      config TEXT, -- JSON config for the tool
      version INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tool_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      type TEXT DEFAULT 'custom',
      config TEXT,
      change_kind TEXT DEFAULT 'update',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_tools (
      agent_id INTEGER,
      tool_id INTEGER,
      PRIMARY KEY (agent_id, tool_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (tool_id) REFERENCES tools(id)
    );

    CREATE TABLE IF NOT EXISTS crew_agents (
      crew_id INTEGER,
      agent_id INTEGER,
      PRIMARY KEY (crew_id, agent_id),
      FOREIGN KEY (crew_id) REFERENCES crews(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      expected_output TEXT NOT NULL,
      agent_id INTEGER,
      crew_id INTEGER,
      status TEXT DEFAULT 'pending',
      result TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (crew_id) REFERENCES crews(id)
    );
    
    CREATE TABLE IF NOT EXISTS crew_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id INTEGER,
      status TEXT DEFAULT 'running',
      initial_input TEXT,
      retry_of INTEGER,
      logs TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (crew_id) REFERENCES crews(id)
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id INTEGER,
      agent_id INTEGER,
      agent_execution_id INTEGER,
      tool_name TEXT NOT NULL,
      tool_type TEXT,
      status TEXT DEFAULT 'running',
      args TEXT,
      result TEXT,
      error TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tool_id) REFERENCES tools(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_session_memory (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, key),
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crew_execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT NOT NULL,
      payload TEXT,
      FOREIGN KEY (execution_id) REFERENCES crew_executions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL UNIQUE,
      input_usd REAL NOT NULL,
      output_usd REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      finished_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS mcp_exposed_tools (
      tool_id INTEGER PRIMARY KEY,
      exposed_name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mcp_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      is_exposed INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mcp_exposed_tool_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      exposed_name TEXT,
      description TEXT,
      is_exposed INTEGER DEFAULT 1,
      change_kind TEXT DEFAULT 'update',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mcp_bundle_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      tool_ids TEXT,
      change_kind TEXT DEFAULT 'update',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bundle_id) REFERENCES mcp_bundles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mcp_bundle_tools (
      bundle_id INTEGER NOT NULL,
      tool_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bundle_id, tool_id),
      FOREIGN KEY (bundle_id) REFERENCES mcp_bundles(id) ON DELETE CASCADE,
      FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_tools (
      agent_id INTEGER NOT NULL,
      tool_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, tool_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_bundles (
      agent_id INTEGER NOT NULL,
      bundle_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, bundle_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (bundle_id) REFERENCES mcp_bundles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      file_path TEXT,
      content TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER,
      tags TEXT, -- JSON array
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id INTEGER NOT NULL,
      embedding TEXT NOT NULL, -- JSON array of floats
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledgebase_indexes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      embedding_config TEXT NOT NULL, -- JSON
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledgebase_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      index_id INTEGER NOT NULL,
      agent_id INTEGER,
      query TEXT NOT NULL,
      results_count INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (index_id) REFERENCES knowledgebase_indexes(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );
  `);

  // Migrations
  try {
    const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as any[];
    const projectColumnNames = projectColumns.map(col => col.name);
    if (!projectColumnNames.includes('platform_project_id')) {
      db.exec("ALTER TABLE projects ADD COLUMN platform_project_id TEXT");
    }
    const hasProjectLinks = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('project_links') as any)?.name;
    if (!hasProjectLinks) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_links (
          project_id INTEGER PRIMARY KEY,
          platform_project_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `);
    }
    db.exec(`
      UPDATE projects
      SET platform_project_id = (
        SELECT platform_project_id
        FROM project_links
        WHERE project_links.project_id = projects.id
      )
      WHERE (platform_project_id IS NULL OR platform_project_id = '')
        AND EXISTS (
          SELECT 1 FROM project_links WHERE project_links.project_id = projects.id
        );
    `);

    // Helper to apply ALTER TABLE columns with debug logs
    const applyColumn = (sql: string) => {
      try {
        db.exec(sql);
      } catch (e: any) {
        // Column already exists is not a fatal error - just log and continue
        const errorMsg = String(e?.message || '');
        if (errorMsg.includes('duplicate column') || errorMsg.includes('already exists')) {
          console.info('Column migration already applied:', sql);
        } else {
          console.error('Failed to apply SQL:', sql, 'error:', e);
          throw e;
        }
      }
    };

    const agentColumns = db.prepare("PRAGMA table_info(agents)").all() as any[];
    const agentColumnNames = agentColumns.map(col => col.name);

    if (!agentColumnNames.includes('provider')) {
      applyColumn("ALTER TABLE agents ADD COLUMN provider TEXT DEFAULT 'google'");
    }
    if (!agentColumnNames.includes('is_exposed')) {
      applyColumn("ALTER TABLE agents ADD COLUMN is_exposed BOOLEAN DEFAULT 0");
    }
    if (!agentColumnNames.includes('project_id')) {
      applyColumn("ALTER TABLE agents ADD COLUMN project_id INTEGER");
    }
    if (!agentColumnNames.includes('agent_role')) {
      applyColumn("ALTER TABLE agents ADD COLUMN agent_role TEXT DEFAULT ''");
    }
    if (!agentColumnNames.includes('status')) {
      applyColumn("ALTER TABLE agents ADD COLUMN status TEXT DEFAULT 'idle'");
    }
    if (!agentColumnNames.includes('system_prompt')) {
      applyColumn("ALTER TABLE agents ADD COLUMN system_prompt TEXT");
    }
    if (!agentColumnNames.includes('temperature')) {
      applyColumn("ALTER TABLE agents ADD COLUMN temperature REAL");
    }
    if (!agentColumnNames.includes('max_tokens')) {
      applyColumn("ALTER TABLE agents ADD COLUMN max_tokens INTEGER");
    }
    if (!agentColumnNames.includes('memory_window')) {
      applyColumn("ALTER TABLE agents ADD COLUMN memory_window INTEGER");
    }
    if (!agentColumnNames.includes('max_iterations')) {
      applyColumn("ALTER TABLE agents ADD COLUMN max_iterations INTEGER");
    }
    if (!agentColumnNames.includes('tools_enabled')) {
      applyColumn("ALTER TABLE agents ADD COLUMN tools_enabled BOOLEAN DEFAULT 1");
    }
    if (!agentColumnNames.includes('retry_policy')) {
      applyColumn("ALTER TABLE agents ADD COLUMN retry_policy TEXT");
    }
    if (!agentColumnNames.includes('timeout_ms')) {
      applyColumn("ALTER TABLE agents ADD COLUMN timeout_ms INTEGER");
    }

    const credentialColumns = db.prepare("PRAGMA table_info(credentials)").all() as any[];
    const credentialColumnNames = credentialColumns.map(col => col.name);

    if (!credentialColumnNames.includes('name')) {
      db.exec("ALTER TABLE credentials ADD COLUMN name TEXT");
      db.exec("UPDATE credentials SET name = provider WHERE name IS NULL OR name = ''");
    }
    if (!credentialColumnNames.includes('key_name')) {
      db.exec("ALTER TABLE credentials ADD COLUMN key_name TEXT");
      db.exec("UPDATE credentials SET key_name = 'Authorization' WHERE key_name IS NULL OR key_name = ''");
    }
    if (!credentialColumnNames.includes('category')) {
      db.exec("ALTER TABLE credentials ADD COLUMN category TEXT DEFAULT 'general'");
      db.exec("UPDATE credentials SET category = 'general' WHERE category IS NULL OR category = ''");
    }

    const crewColumns = db.prepare("PRAGMA table_info(crews)").all() as any[];
    const crewColumnNames = crewColumns.map(col => col.name);

    if (!crewColumnNames.includes('project_id')) {
      db.exec("ALTER TABLE crews ADD COLUMN project_id INTEGER");
    }
    if (!crewColumnNames.includes('is_exposed')) {
      db.exec("ALTER TABLE crews ADD COLUMN is_exposed BOOLEAN DEFAULT 0");
    }
    if (!crewColumnNames.includes('description')) {
      db.exec("ALTER TABLE crews ADD COLUMN description TEXT");
    }
    if (!crewColumnNames.includes('max_runtime_ms')) {
      db.exec("ALTER TABLE crews ADD COLUMN max_runtime_ms INTEGER");
    }
    if (!crewColumnNames.includes('max_cost_usd')) {
      db.exec("ALTER TABLE crews ADD COLUMN max_cost_usd REAL");
    }
    if (!crewColumnNames.includes('max_tool_calls')) {
      db.exec("ALTER TABLE crews ADD COLUMN max_tool_calls INTEGER");
    }
    if (!crewColumnNames.includes('coordinator_agent_id')) {
      db.exec("ALTER TABLE crews ADD COLUMN coordinator_agent_id INTEGER");
    }

    const execColumns = db.prepare("PRAGMA table_info(crew_executions)").all() as any[];
    const execColumnNames = execColumns.map(col => col.name);

    if (!execColumnNames.includes('prompt_tokens')) {
      db.exec("ALTER TABLE crew_executions ADD COLUMN prompt_tokens INTEGER DEFAULT 0");
      db.exec("ALTER TABLE crew_executions ADD COLUMN completion_tokens INTEGER DEFAULT 0");
      db.exec("ALTER TABLE crew_executions ADD COLUMN total_cost REAL DEFAULT 0.0");
    }
    if (!execColumnNames.includes('initial_input')) {
      db.exec("ALTER TABLE crew_executions ADD COLUMN initial_input TEXT");
    }
    if (!execColumnNames.includes('retry_of')) {
      db.exec("ALTER TABLE crew_executions ADD COLUMN retry_of INTEGER");
    }

    const agentExecColumns = db.prepare("PRAGMA table_info(agent_executions)").all() as any[];
    const agentExecColumnNames = agentExecColumns.map(col => col.name);

    if (!agentExecColumnNames.includes('input')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN input TEXT");
      db.exec("ALTER TABLE agent_executions ADD COLUMN output TEXT");
    }
    if (!agentExecColumnNames.includes('status')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN status TEXT DEFAULT 'completed'");
    }
    if (!agentExecColumnNames.includes('execution_kind')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN execution_kind TEXT DEFAULT 'standard'");
    }
    if (!agentExecColumnNames.includes('parent_execution_id')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN parent_execution_id INTEGER");
    }
    if (!agentExecColumnNames.includes('delegation_title')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN delegation_title TEXT");
    }
    if (!agentExecColumnNames.includes('task')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN task TEXT");
    }
    if (!agentExecColumnNames.includes('retry_of')) {
      db.exec("ALTER TABLE agent_executions ADD COLUMN retry_of INTEGER");
    }

    const hasAgentDelegations = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('agent_delegations') as any)?.name;
    if (!hasAgentDelegations) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_delegations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          parent_execution_id INTEGER NOT NULL,
          child_execution_id INTEGER,
          child_job_id INTEGER,
          agent_id INTEGER NOT NULL,
          role TEXT DEFAULT 'delegate',
          title TEXT,
          status TEXT DEFAULT 'queued',
          task TEXT,
          result TEXT,
          error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (parent_execution_id) REFERENCES agent_executions(id) ON DELETE CASCADE,
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );
      `);
    }

    const hasToolExecutions = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('tool_executions') as any)?.name;
    if (!hasToolExecutions) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_executions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_id INTEGER,
          agent_id INTEGER,
          agent_execution_id INTEGER,
          tool_name TEXT NOT NULL,
          tool_type TEXT,
          status TEXT DEFAULT 'running',
          args TEXT,
          result TEXT,
          error TEXT,
          duration_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tool_id) REFERENCES tools(id),
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        );
      `);
    }
    const toolExecColumns = db.prepare("PRAGMA table_info(tool_executions)").all() as any[];
    if (!toolExecColumns.some(col => col.name === 'agent_execution_id')) {
      db.exec("ALTER TABLE tool_executions ADD COLUMN agent_execution_id INTEGER");
    }

    const hasAgentSessions = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('agent_sessions') as any)?.name;
    if (!hasAgentSessions) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          agent_id INTEGER NOT NULL,
          user_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );
      `);
    }

    const hasAgentSessionMemory = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('agent_session_memory') as any)?.name;
    if (!hasAgentSessionMemory) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_session_memory (
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (session_id, key),
          FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
        );
      `);
    }

    const hasCrewExecutionLogs = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('crew_execution_logs') as any)?.name;
    if (!hasCrewExecutionLogs) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS crew_execution_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id INTEGER NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          type TEXT NOT NULL,
          payload TEXT,
          FOREIGN KEY (execution_id) REFERENCES crew_executions(id) ON DELETE CASCADE
        );
      `);
    }

    const hasModelPricing = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('model_pricing') as any)?.name;
    if (!hasModelPricing) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_pricing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL UNIQUE,
          input_usd REAL NOT NULL,
          output_usd REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    const hasJobQueue = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('job_queue') as any)?.name;
    if (!hasJobQueue) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          payload TEXT,
          status TEXT DEFAULT 'pending',
          result TEXT,
          error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      finished_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS voice_sessions (
      id TEXT PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      status TEXT DEFAULT 'idle',
      transport TEXT DEFAULT 'websocket',
      voice_provider TEXT DEFAULT 'elevenlabs',
      voice_id TEXT,
      tts_model_id TEXT,
      stt_model_id TEXT,
      transcript TEXT,
      reply_text TEXT,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS voice_session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_voice_profiles (
      agent_id INTEGER PRIMARY KEY,
      voice_provider TEXT DEFAULT 'elevenlabs',
      voice_id TEXT,
      tts_model_id TEXT,
      stt_model_id TEXT,
      output_format TEXT,
      sample_rate INTEGER DEFAULT 16000,
      language_code TEXT DEFAULT 'en',
      auto_tts INTEGER DEFAULT 1,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crew_voice_profiles (
      crew_id INTEGER PRIMARY KEY,
      voice_provider TEXT DEFAULT 'elevenlabs',
      voice_id TEXT,
      tts_model_id TEXT,
      stt_model_id TEXT,
      output_format TEXT,
      sample_rate INTEGER DEFAULT 16000,
      language_code TEXT DEFAULT 'en',
      auto_tts INTEGER DEFAULT 1,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS voice_config_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      voice_provider TEXT DEFAULT 'elevenlabs',
      voice_id TEXT,
      tts_model_id TEXT,
      stt_model_id TEXT,
      output_format TEXT,
      sample_rate INTEGER DEFAULT 16000,
      language_code TEXT DEFAULT 'en',
      auto_tts INTEGER DEFAULT 1,
      notes TEXT,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS resource_owners (
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      owner_user_id TEXT NOT NULL,
      owner_org_id TEXT,
      visibility TEXT DEFAULT 'private',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (resource_type, resource_id)
    );

    CREATE TABLE IF NOT EXISTS resource_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      shared_with_user_id TEXT,
      shared_with_org_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_resource_owners_owner_lookup
      ON resource_owners(resource_type, owner_user_id, owner_org_id, visibility);

    CREATE INDEX IF NOT EXISTS idx_resource_shares_resource_lookup
      ON resource_shares(resource_type, resource_id);

    CREATE INDEX IF NOT EXISTS idx_resource_shares_subject_lookup
      ON resource_shares(resource_type, shared_with_user_id, shared_with_org_id);
  `);
    }

    const hasMcpExposedTools = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('mcp_exposed_tools') as any)?.name;
    if (!hasMcpExposedTools) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_exposed_tools (
          tool_id INTEGER PRIMARY KEY,
          exposed_name TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
        );
      `);
    }

    const hasMcpBundles = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('mcp_bundles') as any)?.name;
    if (!hasMcpBundles) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_bundles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          is_exposed INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    const hasMcpBundleTools = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('mcp_bundle_tools') as any)?.name;
    if (!hasMcpBundleTools) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_bundle_tools (
          bundle_id INTEGER NOT NULL,
          tool_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (bundle_id, tool_id),
          FOREIGN KEY (bundle_id) REFERENCES mcp_bundles(id) ON DELETE CASCADE,
          FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
        );
      `);
    }
    const hasAgentMcpTools = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('agent_mcp_tools') as any)?.name;
    if (!hasAgentMcpTools) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_mcp_tools (
          agent_id INTEGER NOT NULL,
          tool_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (agent_id, tool_id),
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
          FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
        );
      `);
    }
    const hasAgentMcpBundles = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('agent_mcp_bundles') as any)?.name;
    if (!hasAgentMcpBundles) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_mcp_bundles (
          agent_id INTEGER NOT NULL,
          bundle_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (agent_id, bundle_id),
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
          FOREIGN KEY (bundle_id) REFERENCES mcp_bundles(id) ON DELETE CASCADE
        );
      `);
    }
    const hasMcpExposedToolVersions = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('mcp_exposed_tool_versions') as any)?.name;
    if (!hasMcpExposedToolVersions) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_exposed_tool_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_id INTEGER NOT NULL,
          version_number INTEGER NOT NULL,
          exposed_name TEXT,
          description TEXT,
          is_exposed INTEGER DEFAULT 1,
          change_kind TEXT DEFAULT 'update',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
        );
      `);
    }
    const hasMcpBundleVersions = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('mcp_bundle_versions') as any)?.name;
    if (!hasMcpBundleVersions) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_bundle_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bundle_id INTEGER NOT NULL,
          version_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          description TEXT,
          tool_ids TEXT,
          change_kind TEXT DEFAULT 'update',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (bundle_id) REFERENCES mcp_bundles(id) ON DELETE CASCADE
        );
      `);
    }

    const hasWorkflows = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('workflows') as any)?.name;
    if (!hasWorkflows) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'draft',
          trigger_type TEXT DEFAULT 'manual',
          graph TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          project_id INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        )
      `);
    }

    const hasWorkflowVersions = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('workflow_versions') as any)?.name;
    if (!hasWorkflowVersions) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_id INTEGER NOT NULL,
          version_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'draft',
          trigger_type TEXT DEFAULT 'manual',
          graph TEXT NOT NULL,
          change_kind TEXT DEFAULT 'update',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        )
      `);
    }

    const hasWorkflowRuns = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('workflow_runs') as any)?.name;
    if (!hasWorkflowRuns) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_id INTEGER NOT NULL,
          status TEXT DEFAULT 'running',
          trigger_type TEXT DEFAULT 'manual',
          input TEXT,
          output TEXT,
          logs TEXT DEFAULT '[]',
          graph_snapshot TEXT,
          retry_of INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        )
      `);
    }

    const workflowColumns = db.prepare("PRAGMA table_info(workflows)").all() as any[];
    if (!workflowColumns.some(col => col.name === 'status')) {
      db.exec("ALTER TABLE workflows ADD COLUMN status TEXT DEFAULT 'draft'");
    }
    if (!workflowColumns.some(col => col.name === 'trigger_type')) {
      db.exec("ALTER TABLE workflows ADD COLUMN trigger_type TEXT DEFAULT 'manual'");
    }
    if (!workflowColumns.some(col => col.name === 'version')) {
      db.exec("ALTER TABLE workflows ADD COLUMN version INTEGER DEFAULT 1");
    }
    if (!workflowColumns.some(col => col.name === 'updated_at')) {
      db.exec("ALTER TABLE workflows ADD COLUMN updated_at DATETIME");
      db.exec("UPDATE workflows SET updated_at = datetime('now') WHERE updated_at IS NULL");
    }
    if (!workflowColumns.some(col => col.name === 'project_id')) {
      db.exec("ALTER TABLE workflows ADD COLUMN project_id INTEGER");
    }

    const workflowVersionCount = db.prepare('SELECT COUNT(*) as count FROM workflow_versions').get() as any;
    if (!Number(workflowVersionCount?.count || 0)) {
      db.prepare(`
        INSERT INTO workflow_versions (workflow_id, version_number, name, description, status, trigger_type, graph, change_kind, created_at)
        SELECT id, COALESCE(version, 1), name, description, COALESCE(status, 'draft'), COALESCE(trigger_type, 'manual'), graph, 'imported', COALESCE(updated_at, CURRENT_TIMESTAMP)
        FROM workflows
      `).run();
    }
    db.exec(`
      INSERT INTO mcp_exposed_tool_versions (tool_id, version_number, exposed_name, description, is_exposed, change_kind, created_at)
      SELECT e.tool_id, 1, e.exposed_name, e.description, 1, 'imported', COALESCE(e.updated_at, CURRENT_TIMESTAMP)
      FROM mcp_exposed_tools e
      WHERE NOT EXISTS (
        SELECT 1 FROM mcp_exposed_tool_versions v WHERE v.tool_id = e.tool_id
      );
    `);
    db.exec(`
      INSERT INTO mcp_bundle_versions (bundle_id, version_number, name, slug, description, tool_ids, change_kind, created_at)
      SELECT
        b.id,
        1,
        b.name,
        b.slug,
        b.description,
        COALESCE((
          SELECT json_group_array(bt.tool_id)
          FROM mcp_bundle_tools bt
          WHERE bt.bundle_id = b.id
          ORDER BY bt.tool_id
        ), '[]'),
        'imported',
        COALESCE(b.updated_at, CURRENT_TIMESTAMP)
      FROM mcp_bundles b
      WHERE NOT EXISTS (
        SELECT 1 FROM mcp_bundle_versions v WHERE v.bundle_id = b.id
      );
    `);
    const toolColumns = db.prepare("PRAGMA table_info(tools)").all() as any[];
    if (!toolColumns.some(col => col.name === 'category')) {
      db.exec("ALTER TABLE tools ADD COLUMN category TEXT DEFAULT 'General'");
    }
    if (!toolColumns.some(col => col.name === 'version')) {
      db.exec("ALTER TABLE tools ADD COLUMN version INTEGER DEFAULT 1");
    }
    if (!toolColumns.some(col => col.name === 'updated_at')) {
      db.exec("ALTER TABLE tools ADD COLUMN updated_at DATETIME");
      db.exec("UPDATE tools SET updated_at = datetime('now') WHERE updated_at IS NULL");
    }
    const hasToolVersions = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('tool_versions') as any)?.name;
    if (!hasToolVersions) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_id INTEGER NOT NULL,
          version_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT DEFAULT 'General',
          type TEXT DEFAULT 'custom',
          config TEXT,
          change_kind TEXT DEFAULT 'update',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
        );
      `);
    }
    db.exec(`
      INSERT INTO tool_versions (tool_id, version_number, name, description, category, type, config, change_kind, created_at)
      SELECT t.id, COALESCE(t.version, 1), t.name, t.description, COALESCE(t.category, 'General'), COALESCE(t.type, 'custom'), COALESCE(t.config, '{}'), 'imported', COALESCE(t.updated_at, CURRENT_TIMESTAMP)
      FROM tools t
      WHERE NOT EXISTS (
        SELECT 1 FROM tool_versions tv WHERE tv.tool_id = t.id
      );
    `);
  } catch (e) {
    console.error("Migration error:", e);
  }
}

export function ensureVoiceTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id TEXT PRIMARY KEY,
        agent_id INTEGER NOT NULL,
        status TEXT DEFAULT 'idle',
        transport TEXT DEFAULT 'websocket',
        voice_provider TEXT DEFAULT 'elevenlabs',
        voice_id TEXT,
        tts_model_id TEXT,
        stt_model_id TEXT,
        transcript TEXT,
        reply_text TEXT,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS voice_session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_voice_profiles (
        agent_id INTEGER PRIMARY KEY,
        voice_provider TEXT DEFAULT 'elevenlabs',
        voice_id TEXT,
        tts_model_id TEXT,
        stt_model_id TEXT,
        output_format TEXT,
        sample_rate INTEGER DEFAULT 16000,
        language_code TEXT DEFAULT 'en',
        auto_tts INTEGER DEFAULT 1,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS crew_voice_profiles (
        crew_id INTEGER PRIMARY KEY,
        voice_provider TEXT DEFAULT 'elevenlabs',
        voice_id TEXT,
        tts_model_id TEXT,
        stt_model_id TEXT,
        output_format TEXT,
        sample_rate INTEGER DEFAULT 16000,
        language_code TEXT DEFAULT 'en',
        auto_tts INTEGER DEFAULT 1,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS voice_config_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        voice_provider TEXT DEFAULT 'elevenlabs',
        voice_id TEXT,
        tts_model_id TEXT,
        stt_model_id TEXT,
        output_format TEXT,
        sample_rate INTEGER DEFAULT 16000,
        language_code TEXT DEFAULT 'en',
        auto_tts INTEGER DEFAULT 1,
        notes TEXT,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS resource_owners (
        resource_type TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        owner_user_id TEXT NOT NULL,
        owner_org_id TEXT,
        visibility TEXT DEFAULT 'private',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (resource_type, resource_id)
      );

      CREATE TABLE IF NOT EXISTS resource_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_type TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        shared_with_user_id TEXT,
        shared_with_org_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_resource_owners_owner_lookup
        ON resource_owners(resource_type, owner_user_id, owner_org_id, visibility);

      CREATE INDEX IF NOT EXISTS idx_resource_shares_resource_lookup
        ON resource_shares(resource_type, resource_id);

      CREATE INDEX IF NOT EXISTS idx_resource_shares_subject_lookup
        ON resource_shares(resource_type, shared_with_user_id, shared_with_org_id);
    `);
    const voicePresetColumns = db.prepare("PRAGMA table_info(voice_config_presets)").all() as Array<{ name: string }>;
    if (!voicePresetColumns.some((column) => column.name === 'meta')) {
      db.exec('ALTER TABLE voice_config_presets ADD COLUMN meta TEXT');
    }
  } catch (e) {
    console.error('Voice table migration error:', e);
    throw e;
  }
}

export function ensureAttachmentTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        scope_type TEXT,
        scope_id TEXT,
        agent_id INTEGER,
        crew_id INTEGER,
        uploader_user_id TEXT,
        uploader_org_id TEXT,
        kind TEXT DEFAULT 'file',
        original_name TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        storage_provider TEXT DEFAULT 'gcs',
        storage_key TEXT NOT NULL,
        file_url TEXT NOT NULL,
        local_path TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_scope_lookup
        ON attachments(scope_type, scope_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_attachments_agent_lookup
        ON attachments(agent_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_attachments_crew_lookup
        ON attachments(crew_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_attachments_uploader_lookup
        ON attachments(uploader_user_id, uploader_org_id, created_at);

      CREATE TABLE IF NOT EXISTS attachment_public_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_attachment_public_links_attachment_lookup
        ON attachment_public_links(attachment_id, expires_at);

      CREATE INDEX IF NOT EXISTS idx_attachment_public_links_token_lookup
        ON attachment_public_links(token, expires_at);
    `);
    const attachmentColumns = db.prepare("PRAGMA table_info(attachments)").all() as Array<{ name: string }>;
    if (!attachmentColumns.some((column) => column.name === 'local_path')) {
      db.exec('ALTER TABLE attachments ADD COLUMN local_path TEXT');
    }
  } catch (e) {
    console.error('Attachment table migration error:', e);
    throw e;
  }
}

export function ensureLearningTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_agent_preferences (
        user_id TEXT NOT NULL,
        agent_id INTEGER NOT NULL,
        preference_text TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, agent_id),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS run_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id INTEGER NOT NULL,
        agent_id INTEGER NOT NULL,
        user_id TEXT,
        session_id TEXT,
        rating TEXT,
        solved INTEGER,
        feedback_text TEXT,
        task_signature TEXT,
        tool_sequence TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_learning_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        user_id TEXT,
        lesson_kind TEXT NOT NULL,
        task_signature TEXT,
        guidance TEXT NOT NULL,
        weight INTEGER DEFAULT 50,
        source_feedback_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (source_feedback_id) REFERENCES run_feedback(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_run_feedback_execution_lookup
        ON run_feedback(execution_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_run_feedback_agent_lookup
        ON run_feedback(agent_id, user_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_agent_learning_lessons_lookup
        ON agent_learning_lessons(agent_id, user_id, task_signature, lesson_kind, updated_at);
    `);
  } catch (e) {
    console.error('Learning table migration error:', e);
    throw e;
  }
}

export default db;
