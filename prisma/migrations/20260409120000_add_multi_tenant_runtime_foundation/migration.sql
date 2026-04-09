ALTER TABLE "projects" ADD COLUMN "application_id" TEXT;

CREATE TABLE "connected_applications" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "base_url" TEXT,
    "jwks_url" TEXT,
    "token_issuer" TEXT NOT NULL,
    "token_audience" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connected_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_mcp_gateways" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "auth_mode" TEXT NOT NULL DEFAULT 'signed_jwt',
    "status" TEXT NOT NULL DEFAULT 'active',
    "timeout_ms" INTEGER NOT NULL DEFAULT 15000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_mcp_gateways_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_execution_contexts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT,
    "tenant_external_id" TEXT NOT NULL,
    "user_external_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "session_id" TEXT,
    "roles_jsonb" JSONB,
    "scopes_jsonb" JSONB,
    "allowed_tools_jsonb" JSONB,
    "credential_refs_jsonb" JSONB,
    "source_token_jti" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "agent_execution_contexts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_credential_bindings" (
    "id" TEXT NOT NULL,
    "execution_context_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credential_ref" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_external_id" TEXT NOT NULL,
    "scopes_jsonb" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_credential_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_tool_policies" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "agent_id" INTEGER,
    "tool_name" TEXT NOT NULL,
    "gateway_id" TEXT NOT NULL,
    "required_scopes_jsonb" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_policies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orchestrator_tool_executions"
  ADD COLUMN "execution_context_id" TEXT,
  ADD COLUMN "gateway_id" TEXT,
  ADD COLUMN "request_id" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "credential_refs_jsonb" JSONB,
  ADD COLUMN "subject_user_external_id" TEXT,
  ADD COLUMN "subject_tenant_external_id" TEXT;

ALTER TABLE "orchestrator_agent_sessions"
  ADD COLUMN "execution_context_id" TEXT,
  ADD COLUMN "tenant_external_id" TEXT,
  ADD COLUMN "user_external_id" TEXT,
  ADD COLUMN "conversation_id" TEXT;

CREATE UNIQUE INDEX "connected_applications_slug_key" ON "connected_applications"("slug");
CREATE INDEX "projects_application_id_idx" ON "projects"("application_id");
CREATE INDEX "application_mcp_gateways_application_id_idx" ON "application_mcp_gateways"("application_id");
CREATE INDEX "agent_execution_contexts_application_id_tenant_external_id_idx" ON "agent_execution_contexts"("application_id", "tenant_external_id");
CREATE INDEX "agent_execution_contexts_org_id_project_id_idx" ON "agent_execution_contexts"("org_id", "project_id");
CREATE INDEX "agent_execution_contexts_user_external_id_idx" ON "agent_execution_contexts"("user_external_id");
CREATE INDEX "agent_execution_contexts_expires_at_idx" ON "agent_execution_contexts"("expires_at");
CREATE INDEX "agent_credential_bindings_execution_context_id_idx" ON "agent_credential_bindings"("execution_context_id");
CREATE INDEX "agent_credential_bindings_provider_credential_ref_idx" ON "agent_credential_bindings"("provider", "credential_ref");
CREATE INDEX "agent_tool_policies_application_id_tool_name_idx" ON "agent_tool_policies"("application_id", "tool_name");
CREATE INDEX "agent_tool_policies_agent_id_idx" ON "agent_tool_policies"("agent_id");
CREATE INDEX "agent_tool_policies_gateway_id_idx" ON "agent_tool_policies"("gateway_id");
CREATE INDEX "orchestrator_tool_executions_execution_context_id_idx" ON "orchestrator_tool_executions"("execution_context_id");
CREATE INDEX "orchestrator_tool_executions_gateway_id_idx" ON "orchestrator_tool_executions"("gateway_id");
CREATE INDEX "orchestrator_agent_sessions_execution_context_id_idx" ON "orchestrator_agent_sessions"("execution_context_id");

ALTER TABLE "projects" ADD CONSTRAINT "projects_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "connected_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "application_mcp_gateways" ADD CONSTRAINT "application_mcp_gateways_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "connected_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_execution_contexts" ADD CONSTRAINT "agent_execution_contexts_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "connected_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_execution_contexts" ADD CONSTRAINT "agent_execution_contexts_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_execution_contexts" ADD CONSTRAINT "agent_execution_contexts_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_credential_bindings" ADD CONSTRAINT "agent_credential_bindings_execution_context_id_fkey"
  FOREIGN KEY ("execution_context_id") REFERENCES "agent_execution_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_tool_policies" ADD CONSTRAINT "agent_tool_policies_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "connected_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tool_policies" ADD CONSTRAINT "agent_tool_policies_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_tool_policies" ADD CONSTRAINT "agent_tool_policies_gateway_id_fkey"
  FOREIGN KEY ("gateway_id") REFERENCES "application_mcp_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orchestrator_tool_executions" ADD CONSTRAINT "orchestrator_tool_executions_execution_context_id_fkey"
  FOREIGN KEY ("execution_context_id") REFERENCES "agent_execution_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tool_executions" ADD CONSTRAINT "orchestrator_tool_executions_gateway_id_fkey"
  FOREIGN KEY ("gateway_id") REFERENCES "application_mcp_gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orchestrator_agent_sessions" ADD CONSTRAINT "orchestrator_agent_sessions_execution_context_id_fkey"
  FOREIGN KEY ("execution_context_id") REFERENCES "agent_execution_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
