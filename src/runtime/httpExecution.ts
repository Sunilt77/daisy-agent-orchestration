import type express from 'express';

function readTruthyFlag(value: unknown) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function shouldWaitForExecution(req: express.Request) {
  return readTruthyFlag(req.query.wait) || readTruthyFlag(req.body?.wait);
}

export function acceptedExecutionResponse(
  res: express.Response,
  payload: {
    job_id?: number | null;
    execution_id?: number | null;
    run_id?: number | null;
    parent_execution_id?: number | null;
    status?: string;
  },
) {
  return res.status(202).json({
    status: payload.status || 'pending',
    ...(payload.job_id != null ? { job_id: payload.job_id } : {}),
    ...(payload.execution_id != null ? { execution_id: payload.execution_id } : {}),
    ...(payload.run_id != null ? { run_id: payload.run_id } : {}),
    ...(payload.parent_execution_id != null ? { parent_execution_id: payload.parent_execution_id } : {}),
  });
}
