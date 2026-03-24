CREATE TABLE "orchestrator_projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "orchestrator_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "orchestrator_project_links" (
    "project_id" INTEGER NOT NULL,
    "platform_project_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_project_links_pkey" PRIMARY KEY ("project_id")
);

CREATE TABLE "orchestrator_agents" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "agent_role" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "goal" TEXT NOT NULL,
    "backstory" TEXT,
    "system_prompt" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gemini-3-flash-preview',
    "provider" TEXT NOT NULL DEFAULT 'google',
    "temperature" DOUBLE PRECISION,
    "max_tokens" INTEGER,
    "memory_window" INTEGER,
    "max_iterations" INTEGER,
    "tools_enabled" BOOLEAN NOT NULL DEFAULT true,
    "retry_policy" TEXT,
    "timeout_ms" INTEGER,
    "is_exposed" BOOLEAN NOT NULL DEFAULT false,
    "project_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_crews" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "process" TEXT NOT NULL DEFAULT 'sequential',
    "coordinator_agent_id" INTEGER,
    "project_id" INTEGER,
    "is_exposed" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "max_runtime_ms" INTEGER,
    "max_cost_usd" DOUBLE PRECISION,
    "max_tool_calls" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_crews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_workflows" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trigger_type" TEXT NOT NULL DEFAULT 'manual',
    "graph" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_workflow_versions" (
    "id" SERIAL NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trigger_type" TEXT NOT NULL DEFAULT 'manual',
    "graph" TEXT NOT NULL,
    "change_kind" TEXT NOT NULL DEFAULT 'update',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_workflow_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_credentials" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT,
    "key_name" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "api_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_llm_providers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "api_base" TEXT,
    "api_key" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_llm_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_tools" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "type" TEXT NOT NULL DEFAULT 'custom',
    "config" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_tools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_tool_versions" (
    "id" SERIAL NOT NULL,
    "tool_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "type" TEXT NOT NULL DEFAULT 'custom',
    "config" TEXT,
    "change_kind" TEXT NOT NULL DEFAULT 'update',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_tool_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_agent_tools" (
    "agent_id" INTEGER NOT NULL,
    "tool_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_tools_pkey" PRIMARY KEY ("agent_id","tool_id")
);

CREATE TABLE "orchestrator_crew_agents" (
    "crew_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_crew_agents_pkey" PRIMARY KEY ("crew_id","agent_id")
);

CREATE TABLE "orchestrator_tasks" (
    "id" SERIAL NOT NULL,
    "description" TEXT NOT NULL,
    "expected_output" TEXT NOT NULL,
    "agent_id" INTEGER,
    "crew_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_mcp_exposed_tools" (
    "tool_id" INTEGER NOT NULL,
    "exposed_name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_mcp_exposed_tools_pkey" PRIMARY KEY ("tool_id")
);

CREATE TABLE "orchestrator_mcp_bundles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_mcp_bundles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_mcp_exposed_tool_versions" (
    "id" SERIAL NOT NULL,
    "tool_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "exposed_name" TEXT,
    "description" TEXT,
    "is_exposed" BOOLEAN NOT NULL DEFAULT true,
    "change_kind" TEXT NOT NULL DEFAULT 'update',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_mcp_exposed_tool_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_mcp_bundle_versions" (
    "id" SERIAL NOT NULL,
    "bundle_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "tool_ids" TEXT,
    "change_kind" TEXT NOT NULL DEFAULT 'update',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_mcp_bundle_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_mcp_bundle_tools" (
    "bundle_id" INTEGER NOT NULL,
    "tool_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_mcp_bundle_tools_pkey" PRIMARY KEY ("bundle_id","tool_id")
);

CREATE TABLE "orchestrator_agent_mcp_tools" (
    "agent_id" INTEGER NOT NULL,
    "tool_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_mcp_tools_pkey" PRIMARY KEY ("agent_id","tool_id")
);

CREATE TABLE "orchestrator_agent_mcp_bundles" (
    "agent_id" INTEGER NOT NULL,
    "bundle_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_mcp_bundles_pkey" PRIMARY KEY ("agent_id","bundle_id")
);

CREATE UNIQUE INDEX "orchestrator_credentials_provider_key" ON "orchestrator_credentials"("provider");
CREATE UNIQUE INDEX "orchestrator_mcp_exposed_tools_exposed_name_key" ON "orchestrator_mcp_exposed_tools"("exposed_name");
CREATE UNIQUE INDEX "orchestrator_mcp_bundles_slug_key" ON "orchestrator_mcp_bundles"("slug");
CREATE INDEX "orchestrator_agents_project_id_idx" ON "orchestrator_agents"("project_id");
CREATE INDEX "orchestrator_crews_project_id_idx" ON "orchestrator_crews"("project_id");
CREATE INDEX "orchestrator_workflows_project_id_idx" ON "orchestrator_workflows"("project_id");
CREATE INDEX "orchestrator_workflow_versions_workflow_id_idx" ON "orchestrator_workflow_versions"("workflow_id");
CREATE INDEX "orchestrator_tool_versions_tool_id_idx" ON "orchestrator_tool_versions"("tool_id");
CREATE INDEX "orchestrator_tasks_crew_id_idx" ON "orchestrator_tasks"("crew_id");
CREATE INDEX "orchestrator_tasks_agent_id_idx" ON "orchestrator_tasks"("agent_id");
CREATE INDEX "orchestrator_mcp_exposed_tool_versions_tool_id_idx" ON "orchestrator_mcp_exposed_tool_versions"("tool_id");
CREATE INDEX "orchestrator_mcp_bundle_versions_bundle_id_idx" ON "orchestrator_mcp_bundle_versions"("bundle_id");

ALTER TABLE "orchestrator_project_links" ADD CONSTRAINT "orchestrator_project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "orchestrator_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agents" ADD CONSTRAINT "orchestrator_agents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "orchestrator_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_crews" ADD CONSTRAINT "orchestrator_crews_coordinator_agent_id_fkey" FOREIGN KEY ("coordinator_agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_crews" ADD CONSTRAINT "orchestrator_crews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "orchestrator_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_workflows" ADD CONSTRAINT "orchestrator_workflows_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "orchestrator_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_workflow_versions" ADD CONSTRAINT "orchestrator_workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "orchestrator_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tool_versions" ADD CONSTRAINT "orchestrator_tool_versions_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_tools" ADD CONSTRAINT "orchestrator_agent_tools_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_tools" ADD CONSTRAINT "orchestrator_agent_tools_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_crew_agents" ADD CONSTRAINT "orchestrator_crew_agents_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "orchestrator_crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_crew_agents" ADD CONSTRAINT "orchestrator_crew_agents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tasks" ADD CONSTRAINT "orchestrator_tasks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tasks" ADD CONSTRAINT "orchestrator_tasks_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "orchestrator_crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_mcp_exposed_tools" ADD CONSTRAINT "orchestrator_mcp_exposed_tools_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_mcp_exposed_tool_versions" ADD CONSTRAINT "orchestrator_mcp_exposed_tool_versions_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_mcp_exposed_tools"("tool_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_mcp_bundle_versions" ADD CONSTRAINT "orchestrator_mcp_bundle_versions_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "orchestrator_mcp_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_mcp_bundle_tools" ADD CONSTRAINT "orchestrator_mcp_bundle_tools_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "orchestrator_mcp_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_mcp_bundle_tools" ADD CONSTRAINT "orchestrator_mcp_bundle_tools_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_mcp_tools" ADD CONSTRAINT "orchestrator_agent_mcp_tools_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_mcp_tools" ADD CONSTRAINT "orchestrator_agent_mcp_tools_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_mcp_bundles" ADD CONSTRAINT "orchestrator_agent_mcp_bundles_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_mcp_bundles" ADD CONSTRAINT "orchestrator_agent_mcp_bundles_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "orchestrator_mcp_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
