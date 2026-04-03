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
    const payload = JSON.stringify(logPayload ?? {});
    await prisma.orchestratorCrewExecutionLog.create({
      data: {
        executionId,
        type: logType,
        payload,
      },
    });
    db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
      .run(executionId, logType, payload);
  }
}
