type RuntimeWorkerJob = { id: number; type: string; payload: any };

type StartRuntimeJobWorkerOptions = {
  claimNextJob: (workerId: string) => Promise<RuntimeWorkerJob | null>;
  updateJobResult: (
    jobId: number,
    status: 'completed' | 'failed',
    result?: any,
    error?: string,
    options?: { workerId?: string | null },
  ) => Promise<void>;
  heartbeatJobLease: (jobId: number, workerId: string) => Promise<boolean>;
  failExpiredJobLeases: () => Promise<number>;
  processJob: (job: RuntimeWorkerJob) => Promise<any>;
  createWorkerId: () => string;
  log?: {
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
  concurrency: number;
  timeoutMs: number;
  pollMs?: number;
  leaseSweepMs?: number;
  heartbeatMs?: number;
};

export function startRuntimeJobWorker(options: StartRuntimeJobWorkerOptions) {
  const {
    claimNextJob,
    updateJobResult,
    heartbeatJobLease,
    failExpiredJobLeases,
    processJob,
    createWorkerId,
    log,
    concurrency,
    timeoutMs,
    pollMs = 200,
    leaseSweepMs = 5_000,
    heartbeatMs = 10_000,
  } = options;

  const workerId = createWorkerId();
  let workerRunning = 0;
  let lastLeaseSweepAt = 0;
  let tickInProgress = false;

  return setInterval(async () => {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
    const now = Date.now();
    if (now - lastLeaseSweepAt >= leaseSweepMs) {
      lastLeaseSweepAt = now;
      try {
        const expiredCount = await failExpiredJobLeases();
        if (expiredCount > 0) {
          log?.warn?.(`Expired ${expiredCount} runtime job lease(s)`);
        }
      } catch (error: any) {
        log?.error?.('Failed to sweep expired runtime job leases:', error?.message || error);
      }
    }

    while (workerRunning < concurrency) {
      const next = await claimNextJob(workerId);
      if (!next) break;
      workerRunning += 1;
      let finalized = false;
      let heartbeatHandle: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const finalize = async (status: 'completed' | 'failed', result?: any, error?: string) => {
        if (finalized) return;
        finalized = true;
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
          heartbeatHandle = null;
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        try {
          await updateJobResult(next.id, status, result, error, { workerId });
        } finally {
          workerRunning -= 1;
        }
      };

      heartbeatHandle = setInterval(() => {
        void heartbeatJobLease(next.id, workerId).catch((error: any) => {
          log?.error?.(`Failed to heartbeat job ${next.id}:`, error?.message || error);
        });
      }, heartbeatMs);

      timeoutHandle = setTimeout(() => {
        void finalize('failed', null, `Job timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      processJob(next)
        .then((result) => finalize('completed', result))
        .catch((error: any) => finalize('failed', null, error?.message || 'Job failed'));
    }
    } finally {
      tickInProgress = false;
    }
  }, pollMs);
}
