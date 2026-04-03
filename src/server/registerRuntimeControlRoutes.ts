import type express from 'express';
import { acceptedExecutionResponse, shouldWaitForExecution } from '../runtime/httpExecution';
import { syncCrewExecutionStatus } from '../runtime/executionState';

type CancelToken = { canceled: boolean; reason?: string };

type RegisterRuntimeControlRoutesDeps = {
  app: express.Express;
  db: any;
  getPrisma: () => any;
  getRuntimeAgentExecution: (id: number) => Promise<any>;
  updateRuntimeAgentExecution: (id: number, data: Record<string, any>) => Promise<void>;
  cascadeCancelDelegatedChildren: (parentExecutionId: number, reason: string) => Promise<void>;
  enqueueJob: (type: string, payload: any) => Promise<number>;
  agentCancelTokens: Map<number, CancelToken>;
  crewCancelTokens: Map<number, CancelToken>;
  getCancelToken: (map: Map<number, CancelToken>, id: number) => CancelToken;
};

export function registerRuntimeControlRoutes({
  app,
  db,
  getPrisma,
  getRuntimeAgentExecution,
  updateRuntimeAgentExecution,
  cascadeCancelDelegatedChildren,
  enqueueJob,
  agentCancelTokens,
  crewCancelTokens,
  getCancelToken,
}: RegisterRuntimeControlRoutesDeps) {
  app.post('/api/executions/:id/cancel', async (req, res) => {
    const executionId = Number(req.params.id);
    if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
    const prisma = getPrisma();
    const exec = await prisma.orchestratorCrewExecution.findUnique({ where: { id: executionId } });
    if (!exec) return res.status(404).json({ error: 'Execution not found' });
    if (exec.status !== 'running') return res.status(409).json({ error: 'Execution is not running' });

    const token = getCancelToken(crewCancelTokens, executionId);
    token.canceled = true;
    token.reason = 'Canceled by user';

    await syncCrewExecutionStatus({
      db,
      prisma,
      executionId,
      status: 'canceled',
      logType: 'canceled',
      logPayload: { message: 'Canceled by user' },
    });

    res.json({ success: true });
  });

  app.post('/api/executions/:id/retry', async (req, res) => {
    const executionId = Number(req.params.id);
    if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
    const prisma = getPrisma();
    const exec = await prisma.orchestratorCrewExecution.findUnique({ where: { id: executionId } });
    if (!exec) return res.status(404).json({ error: 'Execution not found' });
    const sqliteExec = db.prepare('SELECT crew_id FROM crew_executions WHERE id = ?').get(executionId) as any;
    const crewId = Number(exec.crewId ?? sqliteExec?.crew_id);
    const hasValidCrewId = Number.isFinite(crewId) && crewId > 0;
    const crew = hasValidCrewId
      ? await prisma.orchestratorCrew.findUnique({ where: { id: crewId } })
      : null;

    const newExec = await prisma.orchestratorCrewExecution.create({
      data: {
        crewId: crew?.id ?? null,
        status: 'pending',
        logs: JSON.stringify([]),
        initialInput: exec.initialInput || '',
        retryOf: executionId,
      },
    });
    const newExecutionId = newExec.id;

    db.prepare('INSERT INTO crew_executions (id, crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newExecutionId, crew?.id ?? (hasValidCrewId ? crewId : null), 'pending', JSON.stringify([]), exec.initialInput || '', executionId);

    if (crew?.id) {
      const jobId = await enqueueJob('run_crew', {
        crewId: Number(crew.id),
        executionId: newExecutionId,
        initialInput: exec.initialInput || '',
        initiatedBy: 'retry_crew_execution',
        retryOfExecutionId: executionId,
      });
      if (!shouldWaitForExecution(req)) {
        return acceptedExecutionResponse(res, { execution_id: newExecutionId, job_id: jobId });
      }
    } else {
      await prisma.orchestratorCrewExecutionLog.create({
        data: {
          executionId: newExecutionId,
          type: 'warning',
          payload: JSON.stringify({ message: 'Retry created without a live crew link; execution preserved for inspection.' }),
        },
      });
    }
    res.json({ success: true, executionId: newExecutionId, retry_of: executionId, status: 'pending' });
  });

  app.post('/api/executions/:id/resume', async (req, res) => {
    const executionId = Number(req.params.id);
    if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
    const prisma = getPrisma();
    const exec = await prisma.orchestratorCrewExecution.findUnique({ where: { id: executionId } });
    if (!exec) return res.status(404).json({ error: 'Execution not found' });
    const sqliteExec = db.prepare('SELECT crew_id FROM crew_executions WHERE id = ?').get(executionId) as any;
    const crewId = Number(exec.crewId ?? sqliteExec?.crew_id);
    const hasValidCrewId = Number.isFinite(crewId) && crewId > 0;
    const crew = hasValidCrewId
      ? await prisma.orchestratorCrew.findUnique({ where: { id: crewId } })
      : null;

    const newExec = await prisma.orchestratorCrewExecution.create({
      data: {
        crewId: crew?.id ?? null,
        status: 'pending',
        logs: JSON.stringify([]),
        initialInput: exec.initialInput || '',
        retryOf: executionId,
      },
    });
    const newExecutionId = newExec.id;

    db.prepare('INSERT INTO crew_executions (id, crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newExecutionId, crew?.id ?? (hasValidCrewId ? crewId : null), 'pending', JSON.stringify([]), exec.initialInput || '', executionId);

    if (crew?.id) {
      const jobId = await enqueueJob('run_crew', {
        crewId: Number(crew.id),
        executionId: newExecutionId,
        initialInput: exec.initialInput || '',
        initiatedBy: 'resume_crew_execution',
        retryOfExecutionId: executionId,
      });
      if (!shouldWaitForExecution(req)) {
        return acceptedExecutionResponse(res, { execution_id: newExecutionId, job_id: jobId });
      }
    } else {
      await prisma.orchestratorCrewExecutionLog.create({
        data: {
          executionId: newExecutionId,
          type: 'warning',
          payload: JSON.stringify({ message: 'Resume created without a live crew link; execution preserved for inspection.' }),
        },
      });
    }
    res.json({ success: true, executionId: newExecutionId, resumed_from: executionId, status: 'pending' });
  });

  app.post('/api/agent-executions/:id/cancel', async (req, res) => {
    const execId = Number(req.params.id);
    if (!Number.isFinite(execId)) return res.status(400).json({ error: 'Invalid execution id' });
    const exec = await getRuntimeAgentExecution(execId);
    if (!exec) return res.status(404).json({ error: 'Execution not found' });
    if (exec.status !== 'running') return res.status(409).json({ error: 'Execution is not running' });

    const token = getCancelToken(agentCancelTokens, execId);
    token.canceled = true;
    token.reason = 'Canceled by user';
    await updateRuntimeAgentExecution(execId, { status: 'canceled' });
    await cascadeCancelDelegatedChildren(execId, 'Canceled by user');
    if (exec.agent_id) {
      db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(exec.agent_id);
    }
    res.json({ success: true });
  });

  app.post('/api/agents/:id/stop-all', async (req, res) => {
    const agentId = Number(req.params.id);
    if (!Number.isFinite(agentId)) return res.status(400).json({ error: 'Invalid agent id' });
    const prisma = getPrisma();
    const agent = await prisma.orchestratorAgent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const runningExecs = await prisma.orchestratorAgentExecution.findMany({
      where: { agentId, status: 'running' },
      select: { id: true }
    });
    for (const row of runningExecs) {
      const token = getCancelToken(agentCancelTokens, Number(row.id));
      token.canceled = true;
      token.reason = 'Canceled by user (stop-all)';
    }

    await prisma.orchestratorAgentExecution.updateMany({
      where: { agentId, status: 'running' },
      data: { status: 'canceled' }
    });
    await prisma.orchestratorAgent.update({
      where: { id: agentId },
      data: { status: 'idle' }
    });

    db.prepare("UPDATE agent_executions SET status = 'canceled' WHERE agent_id = ? AND status = 'running'").run(agentId);
    db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(agentId);

    let canceledQueued = 0;
    let matchedQueued = 0;
    const queueRows = await prisma.orchestratorJobQueue.findMany({
      where: {
        type: 'run_agent',
      },
      orderBy: { id: 'desc' },
      take: 200,
    });

    for (const row of queueRows) {
      let payload: any = {};
      try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch {}
      const payloadAgentId = Number(
        payload?.agentId ??
        payload?.agent_id ??
        payload?.agent?.id ??
        NaN
      );
      const rawPayload = typeof row.payload === 'string' ? row.payload : '';
      if (payloadAgentId !== agentId && !rawPayload.includes(`"agentId":${agentId}`) && !rawPayload.includes(`"agent_id":${agentId}`)) continue;
      matchedQueued++;
      if (row.status !== 'pending' && row.status !== 'running') continue;

      await prisma.orchestratorJobQueue.update({
        where: { id: row.id },
        data: {
          status: 'canceled',
          error: 'Canceled by user (stop-all)',
          finishedAt: new Date()
        }
      });
      db.prepare("UPDATE job_queue SET status = 'canceled', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run('Canceled by user (stop-all)', row.id);
      canceledQueued++;
    }
    res.json({
      success: true,
      canceled_running_executions: runningExecs.length,
      canceled_pending_jobs: canceledQueued > 0 ? canceledQueued : matchedQueued,
    });
  });

  app.get('/api/task-control', async (_req, res) => {
    try {
      const prisma = getPrisma();
      const [runningAgentExecs, runningCrewExecs, pendingJobsRaw, failedAgentExecs, failedCrewExecs] = await Promise.all([
        prisma.orchestratorAgentExecution.findMany({
          where: { status: 'running' },
          include: { agent: { select: { name: true, role: true } } },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.orchestratorCrewExecution.findMany({
          where: { status: 'running' },
          include: { crew: { select: { name: true, process: true } } },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.orchestratorJobQueue.findMany({
          where: { status: 'pending' },
          orderBy: { id: 'desc' },
          take: 200
        }),
        prisma.orchestratorAgentExecution.findMany({
          where: { status: 'failed' },
          include: { agent: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20
        }),
        prisma.orchestratorCrewExecution.findMany({
          where: { status: 'failed' },
          include: { crew: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20
        })
      ]);

      const runningAgentExecutions = runningAgentExecs.map((ae: any) => ({
        id: ae.id,
        agent_id: ae.agentId,
        task: ae.task,
        created_at: ae.createdAt.toISOString(),
        agent_name: ae.agent?.name,
        agent_role: ae.agent?.role
      }));

      const runningCrewExecutions = runningCrewExecs.map((ce: any) => ({
        id: ce.id,
        crew_id: ce.crewId,
        initial_input: ce.initialInput,
        created_at: ce.createdAt.toISOString(),
        crew_name: ce.crew?.name,
        process: ce.crew?.process
      }));

      const pendingJobs = pendingJobsRaw.map((row: any) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        payload: row.payload ? JSON.parse(row.payload) : {}
      }));

      const failedAgentExecutions = failedAgentExecs.map((ae: any) => ({
        id: ae.id,
        agent_id: ae.agentId,
        task: ae.task,
        created_at: ae.createdAt.toISOString(),
        agent_name: ae.agent?.name
      }));

      const failedCrewExecutions = failedCrewExecs.map((ce: any) => ({
        id: ce.id,
        crew_id: ce.crewId,
        initial_input: ce.initialInput,
        created_at: ce.createdAt.toISOString(),
        crew_name: ce.crew?.name
      }));

      res.json({
        runningAgentExecutions,
        runningCrewExecutions,
        pendingJobs,
        failedAgentExecutions,
        failedCrewExecutions,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to load task control data' });
    }
  });

  app.post('/api/task-control/jobs/:id/cancel', async (req, res) => {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) return res.status(400).json({ error: 'Invalid job id' });
    const prisma = getPrisma();
    const row = await prisma.orchestratorJobQueue.findUnique({ where: { id: jobId } });
    if (!row) return res.status(404).json({ error: 'Job not found' });
    if (row.status !== 'pending') return res.status(409).json({ error: 'Only pending jobs can be canceled' });

    await prisma.orchestratorJobQueue.update({
      where: { id: jobId },
      data: { status: 'canceled', error: 'Canceled by user', finishedAt: new Date() }
    });

    db.prepare("UPDATE job_queue SET status = 'canceled', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run('Canceled by user', jobId);
    res.json({ success: true });
  });

  app.post('/api/task-control/stop-running-agents', async (_req, res) => {
    const prisma = getPrisma();
    const running = await prisma.orchestratorAgentExecution.findMany({
      where: { status: 'running' },
      select: { id: true, agentId: true }
    });
    for (const exec of running) {
      const token = getCancelToken(agentCancelTokens, Number(exec.id));
      token.canceled = true;
      token.reason = 'Canceled by user (bulk stop)';
    }

    const updateResult = await prisma.orchestratorAgentExecution.updateMany({
      where: { status: 'running' },
      data: { status: 'canceled' }
    });
    await prisma.orchestratorAgent.updateMany({
      where: { status: 'running' },
      data: { status: 'idle' }
    });

    db.prepare("UPDATE agent_executions SET status = 'canceled' WHERE status = 'running'").run();
    db.prepare("UPDATE agents SET status = 'idle' WHERE status = 'running'").run();

    res.json({ success: true, canceled_running_executions: updateResult.count });
  });

  app.post('/api/task-control/stop-running-crews', async (_req, res) => {
    const prisma = getPrisma();
    const running = await prisma.orchestratorCrewExecution.findMany({
      where: { status: 'running' },
      select: { id: true }
    });
    for (const exec of running) {
      const token = getCancelToken(crewCancelTokens, Number(exec.id));
      token.canceled = true;
      token.reason = 'Canceled by user (bulk stop)';

      await prisma.orchestratorCrewExecutionLog.create({
        data: {
          executionId: Number(exec.id),
          type: 'canceled',
          payload: JSON.stringify({ message: 'Canceled by user (bulk stop)' })
        }
      });

      db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
        .run(Number(exec.id), 'canceled', JSON.stringify({ message: 'Canceled by user (bulk stop)' }));
    }

    const updateResult = await prisma.orchestratorCrewExecution.updateMany({
      where: { status: 'running' },
      data: { status: 'canceled' }
    });

    db.prepare("UPDATE crew_executions SET status = 'canceled' WHERE status = 'running'").run();

    res.json({ success: true, canceled_running_executions: updateResult.count });
  });
}
