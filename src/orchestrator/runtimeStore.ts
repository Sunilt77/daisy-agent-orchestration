import { getPrisma } from '../platform/prisma';
import { uuid } from '../platform/crypto';

export type RuntimeJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

const DEFAULT_JOB_LEASE_MS = Math.max(15_000, Number(process.env.JOB_LEASE_MS || 45_000));

function parseJson(value: string | null | undefined, fallback: any) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function getJobRow(jobId: number) {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const row = await jobQueue.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      result: true,
      error: true,
      workerId: true,
      heartbeatAt: true,
      leaseExpiresAt: true,
      attempts: true,
    },
  });
  return row
    ? {
        id: row.id,
        status: row.status as RuntimeJobStatus,
        result: row.result,
        error: row.error,
        worker_id: row.workerId,
        heartbeat_at: asIso(row.heartbeatAt),
        lease_expires_at: asIso(row.leaseExpiresAt),
        attempts: Number(row.attempts || 0),
      }
    : undefined;
}

export async function enqueueJob(type: string, payload: any) {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const row = await jobQueue.create({
    data: {
      type,
      payload: JSON.stringify(payload ?? {}),
      status: 'pending',
      attempts: 0,
    },
    select: { id: true },
  });
  return Number(row.id);
}

export async function updateJobResult(
  jobId: number,
  status: 'completed' | 'failed' | 'canceled',
  result?: any,
  error?: string,
  options?: { workerId?: string | null }
) {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const where =
    options?.workerId
      ? { id: jobId, workerId: options.workerId }
      : { id: jobId };
  await jobQueue.updateMany({
    where,
    data: {
      status,
      result: result != null ? JSON.stringify(result) : null,
      error: error ?? null,
      finishedAt: new Date(),
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
}

export async function claimNextJob(workerId: string, leaseMs: number = DEFAULT_JOB_LEASE_MS) {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const job = await jobQueue.findFirst({
    where: { status: 'pending' },
    orderBy: { id: 'asc' },
    select: { id: true, type: true, payload: true },
  });
  if (!job) return null;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + Math.max(5_000, leaseMs));
  const claimed = await jobQueue.updateMany({
    where: { id: job.id, status: 'pending' },
    data: {
      status: 'running',
      startedAt: now,
      workerId,
      heartbeatAt: now,
      leaseExpiresAt,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) return null;
  return {
    id: Number(job.id),
    type: job.type,
    payload: parseJson(job.payload, {}),
  };
}

export async function heartbeatJobLease(jobId: number, workerId: string, leaseMs: number = DEFAULT_JOB_LEASE_MS) {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + Math.max(5_000, leaseMs));
  const updated = await jobQueue.updateMany({
    where: { id: jobId, status: 'running', workerId },
    data: {
      heartbeatAt: now,
      leaseExpiresAt,
    },
  });
  return updated.count > 0;
}

export async function failExpiredJobLeases() {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const now = new Date();
  const updated = await jobQueue.updateMany({
    where: {
      status: 'running',
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: 'failed',
      error: 'Job lease expired',
      finishedAt: now,
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
  return updated.count;
}

export async function waitForJob(jobId: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await getJobRow(jobId);
    if (!row) throw new Error('Job not found');
    if (row.status === 'completed') return parseJson(row.result, {});
    if (row.status === 'failed' || row.status === 'canceled') throw new Error(row.error || 'Job failed');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for job');
}

export async function getDelegationRows(parentExecutionId: number) {
  const rows = await getPrisma().orchestratorAgentDelegation.findMany({
    where: { parentExecutionId },
    orderBy: { id: 'asc' },
    include: {
      agent: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    parent_execution_id: row.parentExecutionId,
    child_execution_id: row.childExecutionId,
    child_job_id: row.childJobId,
    agent_id: row.agentId,
    agent_name: row.agent?.name || null,
    role: row.role,
    title: row.title,
    status: row.status,
    task: row.task,
    result: row.result,
    error: row.error,
    created_at: asIso(row.createdAt),
    updated_at: asIso(row.updatedAt),
  }));
}

export async function createDelegatedParentExecution(options: {
  supervisorAgentId: number;
  task: string;
  delegates: Array<{ agentId: number; task: string; title?: string | null }>;
  synthesisAgentId?: number | null;
  synthesize?: boolean;
  source?: string;
}) {
  const {
    supervisorAgentId,
    task,
    delegates,
    synthesisAgentId,
    synthesize = true,
    source = 'delegated_execution',
  } = options;
  const prisma = getPrisma();
  await prisma.orchestratorAgent.update({
    where: { id: supervisorAgentId },
    data: { status: 'running', updatedAt: new Date() },
  });
  const row = await prisma.orchestratorAgentExecution.create({
    data: {
      agentId: supervisorAgentId,
      status: 'running',
      executionKind: 'delegated_parent',
      input: JSON.stringify({
        task,
        delegates,
        synthesis_agent_id: synthesisAgentId ?? null,
        synthesize,
        source,
      }),
      output: '',
      task,
    },
    select: { id: true },
  });
  return Number(row.id);
}

export async function finalizeSupervisorExecution(
  parentExecutionId: number,
  status: 'completed' | 'failed' | 'canceled',
  output: string,
  totalUsage?: { prompt_tokens: number; completion_tokens: number; cost: number }
) {
  const usage = totalUsage || { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  await getPrisma().orchestratorAgentExecution.updateMany({
    where: { id: parentExecutionId },
    data: {
      status,
      output,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalCost: usage.cost,
    },
  });
}

export async function collectExecutionUsage(executionIds: number[]) {
  const ids = Array.from(new Set(executionIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const rows = await getPrisma().orchestratorAgentExecution.findMany({
    where: { id: { in: ids } },
    select: { promptTokens: true, completionTokens: true, totalCost: true },
  });
  return rows.reduce((acc, row) => {
    acc.prompt_tokens += Number(row.promptTokens || 0);
    acc.completion_tokens += Number(row.completionTokens || 0);
    acc.cost += Number(row.totalCost || 0);
    return acc;
  }, { prompt_tokens: 0, completion_tokens: 0, cost: 0 });
}

export type AgentSessionRow = { id: string; user_id: string | null };

export async function ensureAgentSession(agentId: number, sessionId?: string, userId?: string): Promise<AgentSessionRow> {
  const prisma = getPrisma();
  const now = new Date();
  if (sessionId) {
    const existing = await prisma.orchestratorAgentSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
    if (existing) {
      const scoped = await prisma.orchestratorAgentSession.findFirst({
        where: { id: sessionId, agentId },
        select: { id: true, userId: true },
      });
      if (scoped) {
        await prisma.orchestratorAgentSession.update({
          where: { id: sessionId },
          data: { updatedAt: now, lastSeenAt: now },
        });
        return { id: scoped.id, user_id: scoped.userId };
      }
      // The requested session id already belongs to another agent. Treat this as a
      // request for a fresh conversation instead of trying to reuse the foreign id.
      sessionId = undefined;
    }
    if (sessionId) {
      try {
        const created = await prisma.orchestratorAgentSession.create({
          data: {
            id: sessionId,
            agentId,
            userId: userId ?? null,
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
          },
          select: { id: true, userId: true },
        });
        return { id: created.id, user_id: created.userId };
      } catch {
        // Race or stale id collision. Fall through to a fresh session id.
      }
    }
  }

  if (userId) {
    const existing = await prisma.orchestratorAgentSession.findFirst({
      where: { agentId, userId },
      orderBy: [{ lastSeenAt: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, userId: true },
    });
    if (existing) {
      await prisma.orchestratorAgentSession.update({
        where: { id: existing.id },
        data: { updatedAt: now, lastSeenAt: now },
      });
      return { id: existing.id, user_id: existing.userId };
    }
  }

  const created = await prisma.orchestratorAgentSession.create({
    data: {
      id: uuid(),
      agentId,
      userId: userId ?? null,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    },
    select: { id: true, userId: true },
  });
  return { id: created.id, user_id: created.userId };
}

export async function loadSessionConversation(sessionId: string) {
  const row = await getPrisma().orchestratorAgentSessionMemory.findUnique({
    where: { sessionId_key: { sessionId, key: 'conversation' } },
    select: { value: true },
  });
  const parsed = parseJson(row?.value, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function loadSessionSummary(sessionId: string) {
  const row = await getPrisma().orchestratorAgentSessionMemory.findUnique({
    where: { sessionId_key: { sessionId, key: 'conversation_summary' } },
    select: { value: true },
  });
  return row?.value ? String(row.value) : '';
}

export async function saveSessionConversation(
  sessionId: string,
  messages: Array<{ role: string; content: string; ts?: string; attachments?: Array<Record<string, any>> }>
) {
  await getPrisma().orchestratorAgentSessionMemory.upsert({
    where: { sessionId_key: { sessionId, key: 'conversation' } },
    update: { value: JSON.stringify(messages), updatedAt: new Date() },
    create: { sessionId, key: 'conversation', value: JSON.stringify(messages), updatedAt: new Date() },
  });
}

export async function saveSessionSummary(sessionId: string, summary: string) {
  await getPrisma().orchestratorAgentSessionMemory.upsert({
    where: { sessionId_key: { sessionId, key: 'conversation_summary' } },
    update: { value: summary, updatedAt: new Date() },
    create: { sessionId, key: 'conversation_summary', value: summary, updatedAt: new Date() },
  });
}

export async function createWorkflowRun(workflowId: number, triggerType: string, input: any, graph: string) {
  const row = await getPrisma().orchestratorWorkflowRun.create({
    data: {
      workflowId,
      status: 'pending',
      triggerType,
      input: JSON.stringify(input ?? {}),
      output: null,
      logs: '[]',
      graphSnapshot: graph,
      retryOf: null,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  return Number(row.id);
}

export async function persistWorkflowRun(runId: number, status: string, output: any, logs: any[]) {
  await getPrisma().orchestratorWorkflowRun.update({
    where: { id: runId },
    data: {
      status,
      output: output == null ? null : JSON.stringify(output),
      logs: JSON.stringify(logs),
      updatedAt: new Date(),
    },
  });
}

export async function getWorkflowRun(runId: number) {
  const row = await getPrisma().orchestratorWorkflowRun.findUnique({
    where: { id: runId },
  });
  if (!row) return null;
  return {
    id: row.id,
    workflow_id: row.workflowId,
    status: row.status,
    trigger_type: row.triggerType,
    input: row.input,
    output: row.output,
    logs: row.logs,
    graph_snapshot: row.graphSnapshot,
    retry_of: row.retryOf,
    created_at: asIso(row.createdAt),
    updated_at: asIso(row.updatedAt),
  };
}

export async function recoverRuntimeState() {
  const prisma = getPrisma();
  const jobQueue = prisma.orchestratorJobQueue as any;
  const [jobs, agentExecutions, workflowRuns] = await Promise.all([
    jobQueue.updateMany({
      where: { status: 'running' },
      data: {
        status: 'failed',
        error: 'Recovered after server restart',
        finishedAt: new Date(),
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
      },
    }),
    prisma.orchestratorAgentExecution.updateMany({
      where: { status: 'running' },
      data: { status: 'failed' },
    }),
    prisma.orchestratorWorkflowRun.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', updatedAt: new Date() },
    }),
  ]);
  await prisma.orchestratorAgent.updateMany({
    where: { status: 'running' },
    data: { status: 'idle', updatedAt: new Date() },
  });
  return {
    jobs: jobs.count,
    agentExecutions: agentExecutions.count,
    workflowRuns: workflowRuns.count,
  };
}

export async function createAgentExecution(data: {
  agentId: number;
  status: string;
  executionKind: string;
  parentExecutionId?: number | null;
  delegationTitle?: string | null;
  input?: string | null;
  output?: string | null;
  task?: string | null;
  retryOf?: number | null;
}) {
  const row = await getPrisma().orchestratorAgentExecution.create({
    data: {
      agentId: data.agentId,
      status: data.status,
      executionKind: data.executionKind,
      parentExecutionId: data.parentExecutionId ?? null,
      delegationTitle: data.delegationTitle ?? null,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
      input: data.input ?? null,
      output: data.output ?? null,
      task: data.task ?? null,
      retryOf: data.retryOf ?? null,
    },
    select: { id: true },
  });
  return Number(row.id);
}

export async function updateAgentExecution(execId: number, data: {
  status?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalCost?: number;
  input?: string;
  output?: string;
  task?: string;
}) {
  await getPrisma().orchestratorAgentExecution.update({
    where: { id: execId },
    data: {
      status: data.status,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalCost: data.totalCost,
      input: data.input,
      output: data.output,
      task: data.task,
    },
  });
}

export async function getAgentExecution(execId: number) {
  const row = await getPrisma().orchestratorAgentExecution.findUnique({
    where: { id: execId },
  });
  if (!row) return null;
  return {
    id: row.id,
    agent_id: row.agentId,
    status: row.status,
    execution_kind: row.executionKind,
    parent_execution_id: row.parentExecutionId,
    delegation_title: row.delegationTitle,
    prompt_tokens: row.promptTokens,
    completion_tokens: row.completionTokens,
    total_cost: row.totalCost,
    input: row.input,
    output: row.output,
    task: row.task,
    retry_of: row.retryOf,
    created_at: asIso(row.createdAt),
  };
}

export async function createToolExecution(data: {
  toolId?: number | null;
  agentId?: number | null;
  agentExecutionId?: number | null;
  toolName: string;
  toolType?: string | null;
  args?: string | null;
}) {
  const row = await getPrisma().orchestratorToolExecution.create({
    data: {
      toolId: data.toolId ?? null,
      agentId: data.agentId ?? null,
      agentExecutionId: data.agentExecutionId ?? null,
      toolName: data.toolName,
      toolType: data.toolType ?? null,
      status: 'running',
      args: data.args ?? null,
    },
    select: { id: true },
  });
  return Number(row.id);
}

export async function updateToolExecution(id: number, data: {
  status: string;
  result?: string | null;
  error?: string | null;
  durationMs?: number | null;
}) {
  await getPrisma().orchestratorToolExecution.update({
    where: { id },
    data: {
      status: data.status,
      result: data.result ?? null,
      error: data.error ?? null,
      durationMs: data.durationMs ?? null,
    },
  });
}
