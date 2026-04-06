import { getPrisma } from '../platform/prisma';
import { uuid } from '../platform/crypto';
import { publishAgentExecution, publishWorkflowRun } from '../runtime/executionEvents';

export type RuntimeJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
export const DEFAULT_JOB_PRIORITY = 100;

const DEFAULT_JOB_LEASE_MS = Math.max(15_000, Number(process.env.JOB_LEASE_MS || 45_000));
const WAIT_POLL_FALLBACK_MS = Math.max(250, Number(process.env.JOB_WAIT_POLL_MS || 1000));

type JobTerminalSignal = {
  status: RuntimeJobStatus;
  result: string | null;
  error: string | null;
};

const jobWaiters = new Map<number, Set<(signal: JobTerminalSignal) => void>>();

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

function normalizePriority(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_JOB_PRIORITY;
  return Math.min(1_000, Math.max(0, Math.round(numeric)));
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
      priority: true,
      readyAt: true,
      tenantKey: true,
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
        priority: Number(row.priority ?? DEFAULT_JOB_PRIORITY),
        ready_at: asIso(row.readyAt),
        tenant_key: row.tenantKey ?? 'global',
      }
    : undefined;
}

export async function enqueueJob(
  type: string,
  payload: any,
  options?: {
    priority?: number;
    delayMs?: number;
    tenantKey?: string | null;
  }
) {
  const jobQueue = getPrisma().orchestratorJobQueue as any;
  const readyAt = new Date(Date.now() + Math.max(0, Number(options?.delayMs || 0)));
  const inferredTenantKey = String(
    options?.tenantKey ??
      payload?.tenantKey ??
      payload?.tenant_key ??
      payload?.orgId ??
      payload?.org_id ??
      'global'
  ).trim() || 'global';
  const row = await jobQueue.create({
    data: {
      type,
      payload: JSON.stringify(payload ?? {}),
      status: 'pending',
      attempts: 0,
      priority: normalizePriority(options?.priority),
      readyAt,
      tenantKey: inferredTenantKey,
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
  const serializedResult = result != null ? JSON.stringify(result) : null;
  const where =
    options?.workerId
      ? { id: jobId, workerId: options.workerId }
      : { id: jobId };
  const updated = await jobQueue.updateMany({
    where,
    data: {
      status,
      result: serializedResult,
      error: error ?? null,
      finishedAt: new Date(),
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
  if (updated.count > 0) {
    const waiters = jobWaiters.get(jobId);
    if (waiters?.size) {
      const signal: JobTerminalSignal = { status, result: serializedResult, error: error ?? null };
      for (const waiter of waiters) waiter(signal);
      jobWaiters.delete(jobId);
    }
  }
}

export async function claimNextJob(workerId: string, leaseMs: number = DEFAULT_JOB_LEASE_MS) {
  const prisma = getPrisma();
  const jobQueue = prisma.orchestratorJobQueue as any;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + Math.max(5_000, leaseMs));

  // Single-statement claim avoids race conditions under concurrent workers/processes.
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; type: string; payload: string | null }>>(
      `
      WITH next_tenant AS (
        SELECT COALESCE(tenant_key, 'global') AS tenant_key
        FROM orchestrator_job_queue
        WHERE status = 'pending'
          AND COALESCE(ready_at, NOW()) <= NOW()
        GROUP BY COALESCE(tenant_key, 'global')
        ORDER BY
          MAX(COALESCE(priority, ${DEFAULT_JOB_PRIORITY})) DESC,
          MIN(created_at) ASC
        LIMIT 1
      ),
      candidate AS (
        SELECT id
        FROM orchestrator_job_queue
        WHERE status = 'pending'
          AND COALESCE(ready_at, NOW()) <= NOW()
          AND COALESCE(tenant_key, 'global') = (SELECT tenant_key FROM next_tenant)
        ORDER BY
          COALESCE(priority, ${DEFAULT_JOB_PRIORITY}) DESC,
          id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE orchestrator_job_queue q
      SET
        status = 'running',
        started_at = $1,
        worker_id = $2,
        heartbeat_at = $1,
        lease_expires_at = $3,
        attempts = COALESCE(attempts, 0) + 1
      FROM candidate
      WHERE q.id = candidate.id
      RETURNING q.id, q.type, q.payload
      `,
      now,
      workerId,
      leaseExpiresAt
    );
    const row = rows?.[0];
    if (row) {
      return {
        id: Number(row.id),
        type: String(row.type || ''),
        payload: parseJson(row.payload, {}),
      };
    }
  } catch {
    // Fallback to optimistic claim for compatibility with older environments.
  }

  const job = await jobQueue.findFirst({
    where: { status: 'pending', readyAt: { lte: new Date() } },
    orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    select: { id: true, type: true, payload: true },
  });
  if (!job) return null;
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
  return { id: Number(job.id), type: job.type, payload: parseJson(job.payload, {}) };
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
  const signalPromise = (ms: number) =>
    new Promise<JobTerminalSignal | null>((resolve) => {
      const timer = setTimeout(() => {
        const waiters = jobWaiters.get(jobId);
        if (waiters) {
          waiters.delete(onSignal);
          if (!waiters.size) jobWaiters.delete(jobId);
        }
        resolve(null);
      }, ms);
      const onSignal = (signal: JobTerminalSignal) => {
        clearTimeout(timer);
        resolve(signal);
      };
      const waiters = jobWaiters.get(jobId);
      if (waiters) {
        waiters.add(onSignal);
      } else {
        jobWaiters.set(jobId, new Set([onSignal]));
      }
    });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await getJobRow(jobId);
    if (!row) throw new Error('Job not found');
    if (row.status === 'completed') return parseJson(row.result, {});
    if (row.status === 'failed' || row.status === 'canceled') throw new Error(row.error || 'Job failed');

    const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    if (!remainingMs) break;
    const signal = await signalPromise(Math.min(WAIT_POLL_FALLBACK_MS, remainingMs));
    if (!signal) continue;
    if (signal.status === 'completed') return parseJson(signal.result, {});
    throw new Error(signal.error || 'Job failed');
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
  publishAgentExecution(Number(row.id), 'created');
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
  publishAgentExecution(parentExecutionId, 'finalized');
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
  publishWorkflowRun(Number(row.id), 'created');
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
  publishWorkflowRun(runId, 'updated');
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
  publishAgentExecution(Number(row.id), 'created');
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
  publishAgentExecution(execId, 'updated');
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
  const updated = await getPrisma().orchestratorToolExecution.update({
    where: { id },
    data: {
      status: data.status,
      result: data.result ?? null,
      error: data.error ?? null,
      durationMs: data.durationMs ?? null,
    },
  });
  const executionId = Number((updated as any)?.agentExecutionId || 0);
  if (executionId > 0) publishAgentExecution(executionId, 'tool_updated');
}

export async function getExecutionCostTotals(options: {
  crewIds?: number[];
  agentIds?: number[];
}) {
  const prisma = getPrisma();
  const crewIds = Array.from(new Set((options.crewIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
  const agentIds = Array.from(new Set((options.agentIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));

  const [crewAggregate, agentAggregate] = await Promise.all([
    crewIds.length
      ? prisma.orchestratorCrewExecution.aggregate({
          where: { crewId: { in: crewIds } },
          _sum: { totalCost: true },
        })
      : Promise.resolve({ _sum: { totalCost: 0 } }),
    agentIds.length
      ? prisma.orchestratorAgentExecution.aggregate({
          where: { agentId: { in: agentIds } },
          _sum: { totalCost: true },
        })
      : Promise.resolve({ _sum: { totalCost: 0 } }),
  ]);

  return {
    crewCost: Number(crewAggregate._sum.totalCost || 0),
    agentCost: Number(agentAggregate._sum.totalCost || 0),
  };
}

export async function pruneRuntimeRetention(cutoffDate: Date) {
  const prisma = getPrisma();
  const [crewLogs, crewExecutions, agentExecutions, toolExecutions, jobs] = await Promise.all([
    prisma.orchestratorCrewExecutionLog.deleteMany({ where: { timestamp: { lt: cutoffDate } } }),
    prisma.orchestratorCrewExecution.deleteMany({ where: { createdAt: { lt: cutoffDate }, status: { not: 'running' } } }),
    prisma.orchestratorAgentExecution.deleteMany({ where: { createdAt: { lt: cutoffDate }, status: { not: 'running' } } }),
    prisma.orchestratorToolExecution.deleteMany({ where: { createdAt: { lt: cutoffDate }, status: { not: 'running' } } }),
    prisma.orchestratorJobQueue.deleteMany({ where: { startedAt: { lt: cutoffDate }, status: { notIn: ['pending', 'running'] } } }),
  ]);

  return {
    crewLogs: crewLogs.count,
    crewExecutions: crewExecutions.count,
    agentExecutions: agentExecutions.count,
    toolExecutions: toolExecutions.count,
    jobs: jobs.count,
  };
}
