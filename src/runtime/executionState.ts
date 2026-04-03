type CrewLogPayload = Record<string, unknown>;

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
