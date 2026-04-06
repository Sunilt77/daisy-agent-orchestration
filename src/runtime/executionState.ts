import { publishCrewExecution } from './executionEvents';
type CrewLogPayload = Record<string, unknown>;
type CrewExecutionRecord = {
  id: number;
  crew_id: number | null;
  status: string;
  initial_input: string | null;
  retry_of: number | null;
  logs: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  created_at: string;
};

export type RuntimeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

const TERMINAL_STATUSES = new Set<RuntimeExecutionStatus>(['completed', 'failed', 'canceled']);

export function normalizeRuntimeExecutionStatus(value: unknown, fallback: RuntimeExecutionStatus = 'pending'): RuntimeExecutionStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'pending' ||
    normalized === 'running' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'canceled'
  ) {
    return normalized;
  }
  return fallback;
}

export function isTerminalRuntimeExecutionStatus(value: unknown) {
  return TERMINAL_STATUSES.has(normalizeRuntimeExecutionStatus(value, 'pending'));
}

export async function createCrewExecutionRecord(options: {
  db: any;
  prisma: any;
  crewId: number | null;
  initialInput?: string;
  retryOf?: number | null;
  status?: RuntimeExecutionStatus;
}) {
  const {
    db,
    prisma,
    crewId,
    initialInput = '',
    retryOf = null,
    status = 'pending',
  } = options;

  const execution = await prisma.orchestratorCrewExecution.create({
    data: {
      crewId,
      status,
      logs: JSON.stringify([]),
      initialInput,
      retryOf,
    },
  });

  db.prepare('INSERT INTO crew_executions (id, crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?, ?)')
    .run(execution.id, crewId, status, JSON.stringify([]), initialInput, retryOf);
  publishCrewExecution(Number(execution.id), 'created');

  return execution;
}

export async function appendCrewExecutionLog(options: {
  db: any;
  prisma: any;
  executionId: number;
  type: string;
  payload?: CrewLogPayload;
}) {
  const { db, prisma, executionId, type, payload } = options;
  const serializedPayload = JSON.stringify(payload ?? {});

  await prisma.orchestratorCrewExecutionLog.create({
    data: {
      executionId,
      type,
      payload: serializedPayload,
    },
  });

  db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
    .run(executionId, type, serializedPayload);
  publishCrewExecution(executionId, `log:${type}`);
}

export async function syncCrewExecutionMetrics(options: {
  db: any;
  prisma: any;
  executionId: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}) {
  const { db, prisma, executionId, promptTokens, completionTokens, totalCost } = options;

  await prisma.orchestratorCrewExecution.updateMany({
    where: { id: executionId },
    data: {
      promptTokens,
      completionTokens,
      totalCost,
    },
  });

  db.prepare('UPDATE crew_executions SET prompt_tokens = ?, completion_tokens = ?, total_cost = ? WHERE id = ?')
    .run(promptTokens, completionTokens, totalCost, executionId);
  publishCrewExecution(executionId, 'metrics_updated');
}

export async function getCrewExecutionStatus(options: {
  prisma: any;
  executionId: number;
}) {
  const { prisma, executionId } = options;
  const execution = await prisma.orchestratorCrewExecution.findUnique({
    where: { id: executionId },
    select: { status: true },
  });
  return normalizeRuntimeExecutionStatus(execution?.status, 'pending');
}

export async function getCrewExecution(options: {
  prisma: any;
  executionId: number;
}) {
  const { prisma, executionId } = options;
  const execution = await prisma.orchestratorCrewExecution.findUnique({
    where: { id: executionId },
  });
  if (!execution) return null;
  const row: CrewExecutionRecord = {
    id: execution.id,
    crew_id: execution.crewId ?? null,
    status: execution.status,
    initial_input: execution.initialInput ?? null,
    retry_of: execution.retryOf ?? null,
    logs: execution.logs ?? null,
    prompt_tokens: Number(execution.promptTokens || 0),
    completion_tokens: Number(execution.completionTokens || 0),
    total_cost: Number(execution.totalCost || 0),
    created_at: execution.createdAt.toISOString(),
  };
  return row;
}

export async function readCrewExecutionLogs(options: {
  prisma: any;
  executionId: number;
}) {
  const { prisma, executionId } = options;
  const rows = await prisma.orchestratorCrewExecutionLog.findMany({
    where: { executionId },
    orderBy: { id: 'asc' },
  });
  return rows.map((row: any) => {
    let payload: any = {};
    try {
      payload = row.payload ? JSON.parse(row.payload) : {};
    } catch {
      payload = {};
    }
    return {
      timestamp: row.timestamp?.toISOString?.() ?? null,
      ...payload,
      type: row.type,
    };
  });
}

export async function recoverCrewExecutionState(options: {
  db: any;
  prisma: any;
  reason?: string;
}) {
  const { db, prisma, reason = 'Recovered after server restart' } = options;
  const runningExecutions = await prisma.orchestratorCrewExecution.findMany({
    where: { status: 'running' },
    select: { id: true },
  });

  if (!runningExecutions.length) {
    return { count: 0 };
  }

  for (const execution of runningExecutions) {
    await syncCrewExecutionStatus({
      db,
      prisma,
      executionId: Number(execution.id),
      status: 'failed',
      logType: 'error',
      logPayload: { message: reason },
    });
  }

  return { count: runningExecutions.length };
}

export async function syncAgentStatus(options: {
  db: any;
  prisma: any;
  agentId: number;
  status: string;
}) {
  const { db, prisma, agentId, status } = options;
  await prisma.orchestratorAgent.updateMany({
    where: { id: agentId },
    data: { status, updatedAt: new Date() },
  });
  db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, agentId);
}

export async function syncAgentStatuses(options: {
  db: any;
  prisma: any;
  fromStatus: string;
  toStatus: string;
}) {
  const { db, prisma, fromStatus, toStatus } = options;
  const result = await prisma.orchestratorAgent.updateMany({
    where: { status: fromStatus },
    data: { status: toStatus, updatedAt: new Date() },
  });
  db.prepare('UPDATE agents SET status = ? WHERE status = ?').run(toStatus, fromStatus);
  return result.count;
}

export async function syncAgentExecutionStatuses(options: {
  db: any;
  prisma: any;
  agentId?: number;
  fromStatus: string;
  toStatus: string;
}) {
  const { db, prisma, agentId, fromStatus, toStatus } = options;
  const where = agentId != null
    ? { agentId, status: fromStatus }
    : { status: fromStatus };
  const result = await prisma.orchestratorAgentExecution.updateMany({
    where,
    data: { status: toStatus },
  });
  if (agentId != null) {
    db.prepare('UPDATE agent_executions SET status = ? WHERE agent_id = ? AND status = ?').run(toStatus, agentId, fromStatus);
  } else {
    db.prepare('UPDATE agent_executions SET status = ? WHERE status = ?').run(toStatus, fromStatus);
  }
  return result.count;
}

export async function syncCrewExecutionStatus(options: {
  db: any;
  prisma: any;
  executionId: number;
  status: RuntimeExecutionStatus;
  logType?: string;
  logPayload?: CrewLogPayload;
}) {
  const { db, prisma, executionId, status, logType, logPayload } = options;
  await prisma.orchestratorCrewExecution.updateMany({
    where: { id: executionId },
    data: { status },
  });
  db.prepare('UPDATE crew_executions SET status = ? WHERE id = ?').run(status, executionId);
  publishCrewExecution(executionId, `status:${status}`);

  if (logType) {
    await appendCrewExecutionLog({
      db,
      prisma,
      executionId,
      type: logType,
      payload: logPayload,
    });
  }
}
