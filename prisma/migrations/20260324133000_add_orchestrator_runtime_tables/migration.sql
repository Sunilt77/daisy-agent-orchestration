CREATE TABLE "orchestrator_agent_executions" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "execution_kind" TEXT NOT NULL DEFAULT 'standard',
    "parent_execution_id" INTEGER,
    "delegation_title" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "input" TEXT,
    "output" TEXT,
    "task" TEXT,
    "retry_of" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_job_queue" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "error" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "ready_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "orchestrator_job_queue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_agent_delegations" (
    "id" SERIAL NOT NULL,
    "parent_execution_id" INTEGER NOT NULL,
    "child_execution_id" INTEGER,
    "child_job_id" INTEGER,
    "agent_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'delegate',
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "task" TEXT,
    "result" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_delegations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_crew_executions" (
    "id" SERIAL NOT NULL,
    "crew_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "initial_input" TEXT,
    "retry_of" INTEGER,
    "logs" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_crew_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_tool_executions" (
    "id" SERIAL NOT NULL,
    "tool_id" INTEGER,
    "agent_id" INTEGER,
    "agent_execution_id" INTEGER,
    "tool_name" TEXT NOT NULL,
    "tool_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "args" TEXT,
    "result" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_tool_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_agent_sessions" (
    "id" TEXT NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_agent_session_memory" (
    "session_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_agent_session_memory_pkey" PRIMARY KEY ("session_id","key")
);

CREATE TABLE "orchestrator_crew_execution_logs" (
    "id" SERIAL NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "payload" TEXT,

    CONSTRAINT "orchestrator_crew_execution_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestrator_workflow_runs" (
    "id" SERIAL NOT NULL,
    "workflow_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger_type" TEXT NOT NULL DEFAULT 'manual',
    "input" TEXT,
    "output" TEXT,
    "logs" TEXT NOT NULL DEFAULT '[]',
    "graph_snapshot" TEXT,
    "retry_of" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestrator_workflow_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "orchestrator_agent_executions_agent_id_idx" ON "orchestrator_agent_executions"("agent_id");
CREATE INDEX "orchestrator_agent_executions_status_idx" ON "orchestrator_agent_executions"("status");
CREATE INDEX "orchestrator_agent_executions_parent_execution_id_idx" ON "orchestrator_agent_executions"("parent_execution_id");
CREATE INDEX "orchestrator_job_queue_status_idx" ON "orchestrator_job_queue"("status");
CREATE INDEX "orchestrator_job_queue_status_ready_priority_idx" ON "orchestrator_job_queue"("status", "ready_at", "priority" DESC, "id");
CREATE INDEX "orchestrator_agent_delegations_parent_execution_id_idx" ON "orchestrator_agent_delegations"("parent_execution_id");
CREATE INDEX "orchestrator_agent_delegations_agent_id_idx" ON "orchestrator_agent_delegations"("agent_id");
CREATE INDEX "orchestrator_agent_delegations_child_execution_id_idx" ON "orchestrator_agent_delegations"("child_execution_id");
CREATE INDEX "orchestrator_agent_delegations_child_job_id_idx" ON "orchestrator_agent_delegations"("child_job_id");
CREATE INDEX "orchestrator_crew_executions_crew_id_idx" ON "orchestrator_crew_executions"("crew_id");
CREATE INDEX "orchestrator_crew_executions_status_idx" ON "orchestrator_crew_executions"("status");
CREATE INDEX "orchestrator_tool_executions_tool_id_idx" ON "orchestrator_tool_executions"("tool_id");
CREATE INDEX "orchestrator_tool_executions_agent_id_idx" ON "orchestrator_tool_executions"("agent_id");
CREATE INDEX "orchestrator_tool_executions_agent_execution_id_idx" ON "orchestrator_tool_executions"("agent_execution_id");
CREATE INDEX "orchestrator_tool_executions_status_idx" ON "orchestrator_tool_executions"("status");
CREATE INDEX "orchestrator_agent_sessions_agent_id_idx" ON "orchestrator_agent_sessions"("agent_id");
CREATE INDEX "orchestrator_crew_execution_logs_execution_id_idx" ON "orchestrator_crew_execution_logs"("execution_id");
CREATE INDEX "orchestrator_workflow_runs_workflow_id_idx" ON "orchestrator_workflow_runs"("workflow_id");
CREATE INDEX "orchestrator_workflow_runs_status_idx" ON "orchestrator_workflow_runs"("status");

ALTER TABLE "orchestrator_agent_executions" ADD CONSTRAINT "orchestrator_agent_executions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_executions" ADD CONSTRAINT "orchestrator_agent_executions_parent_execution_id_fkey" FOREIGN KEY ("parent_execution_id") REFERENCES "orchestrator_agent_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_delegations" ADD CONSTRAINT "orchestrator_agent_delegations_parent_execution_id_fkey" FOREIGN KEY ("parent_execution_id") REFERENCES "orchestrator_agent_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_delegations" ADD CONSTRAINT "orchestrator_agent_delegations_child_execution_id_fkey" FOREIGN KEY ("child_execution_id") REFERENCES "orchestrator_agent_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_delegations" ADD CONSTRAINT "orchestrator_agent_delegations_child_job_id_fkey" FOREIGN KEY ("child_job_id") REFERENCES "orchestrator_job_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_delegations" ADD CONSTRAINT "orchestrator_agent_delegations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_crew_executions" ADD CONSTRAINT "orchestrator_crew_executions_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "orchestrator_crews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tool_executions" ADD CONSTRAINT "orchestrator_tool_executions_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "orchestrator_tools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tool_executions" ADD CONSTRAINT "orchestrator_tool_executions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_tool_executions" ADD CONSTRAINT "orchestrator_tool_executions_agent_execution_id_fkey" FOREIGN KEY ("agent_execution_id") REFERENCES "orchestrator_agent_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_sessions" ADD CONSTRAINT "orchestrator_agent_sessions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "orchestrator_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_agent_session_memory" ADD CONSTRAINT "orchestrator_agent_session_memory_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "orchestrator_agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_crew_execution_logs" ADD CONSTRAINT "orchestrator_crew_execution_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "orchestrator_crew_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestrator_workflow_runs" ADD CONSTRAINT "orchestrator_workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "orchestrator_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
