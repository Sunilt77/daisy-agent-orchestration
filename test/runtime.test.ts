import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import db, { initDb } from '../src/db';
import { ensurePrismaReady, getPrisma } from '../src/platform/prisma';

async function wipeLocalDb() {
  const prisma = await ensurePrismaReady();
  initDb();
  // Clear persistent and runtime orchestrator tables in Postgres
  await prisma.$transaction([
    prisma.orchestratorAgentSessionMemory.deleteMany(),
    prisma.orchestratorAgentSession.deleteMany(),
    prisma.orchestratorAgentTool.deleteMany(),
    prisma.orchestratorAgentMcpTool.deleteMany(),
    prisma.orchestratorAgentMcpBundle.deleteMany(),
    prisma.orchestratorCrewAgent.deleteMany(),
    prisma.orchestratorTask.deleteMany(),
    prisma.orchestratorWorkflowVersion.deleteMany(),
    prisma.orchestratorWorkflowRun.deleteMany(),
    prisma.orchestratorWorkflow.deleteMany(),
    prisma.orchestratorCrewExecutionLog.deleteMany(),
    prisma.orchestratorCrewExecution.deleteMany(),
    prisma.orchestratorToolExecution.deleteMany(),
    prisma.orchestratorMcpBundleTool.deleteMany(),
    prisma.orchestratorMcpBundleVersion.deleteMany(),
    prisma.orchestratorMcpBundle.deleteMany(),
    prisma.orchestratorMcpExposedTool.deleteMany(),
    prisma.orchestratorAgentDelegation.deleteMany(),
    prisma.orchestratorAgentExecution.deleteMany(),
    prisma.orchestratorCrew.deleteMany(),
    prisma.orchestratorAgent.deleteMany(),
    prisma.orchestratorToolVersion.deleteMany(),
    prisma.orchestratorTool.deleteMany(),
    prisma.orchestratorCredential.deleteMany(),
    prisma.orchestratorLlmProvider.deleteMany(),
    prisma.orchestratorProjectLink.deleteMany(),
    prisma.orchestratorProject.deleteMany(),
    prisma.orchestratorJobQueue.deleteMany(),
    prisma.orchestratorSetting.deleteMany(),
  ]);

  const tx = db.transaction(() => {
    const tables = [
      'agent_session_memory',
      'agent_sessions',
      'agent_tools',
      'agent_mcp_tools',
      'agent_mcp_bundles',
      'crew_agents',
      'tasks',
      'workflow_versions',
      'workflow_runs',
      'workflows',
      'crew_execution_logs',
      'crew_executions',
      'tool_executions',
      'mcp_bundle_tools',
      'mcp_bundles',
      'mcp_exposed_tools',
      'agent_delegations',
      'agent_executions',
      'crews',
      'agents',
      'tools',
      'credentials',
      'llm_providers',
      'model_pricing',
      'project_links',
      'projects',
      'job_queue',
      'settings',
    ];
    for (const table of tables) {
      try {
        db.prepare(`DELETE FROM ${table}`).run();
      } catch (e) {
        console.warn(`Failed to clear table ${table}: ${(e as Error).message}`);
      }
    }
  });
  tx();
}

async function createAgent(name = 'Runtime Agent') {
  const prisma = await ensurePrismaReady();
  const agent = await prisma.orchestratorAgent.create({
    data: {
      name,
      role: 'tester',
      goal: 'Validate runtime paths',
      backstory: 'runtime test backstory',
      systemPrompt: 'Respond with JSON only.',
      provider: 'google',
      model: 'gemini-1.5-flash',
      status: 'running',
    },
  });

  db.prepare(`
    INSERT INTO agents (id, name, role, goal, backstory, system_prompt, provider, model, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.id,
    agent.name,
    agent.role,
    agent.goal,
    agent.backstory,
    agent.systemPrompt,
    agent.provider,
    agent.model,
    agent.status
  );
  return agent.id;
}

async function createCrew(name = 'Runtime Crew') {
  const prisma = await ensurePrismaReady();
  const crew = await prisma.orchestratorCrew.create({
    data: {
      name,
      description: 'runtime crew description',
      process: 'sequential',
    },
  });

  db.prepare(`
    INSERT INTO crews (id, name, description, process)
    VALUES (?, ?, ?, ?)
  `).run(crew.id, crew.name, crew.description, crew.process);
  return crew.id;
}

describe.sequential('runtime + streaming + control APIs', () => {
  beforeEach(async () => {
    await wipeLocalDb();
  });


  it('returns timeline and SSE stream snapshots for agent executions', async () => {
    const agentId = await createAgent();
    const prisma = getPrisma();
    const exec = await prisma.orchestratorAgentExecution.create({
      data: {
        agentId,
        status: 'completed',
        executionKind: 'agent_run',
        task: 'find status',
        input: 'in',
        output: 'out',
      },
    });
    const execId = exec.id;

    await prisma.orchestratorToolExecution.create({
      data: {
        toolName: 'searchPlaces',
        toolType: 'http',
        status: 'completed',
        durationMs: 42,
        agentExecutionId: execId,
        agentId,
        args: '{"q":"x"}',
        result: '{"ok":true}',
      },
    });

    // Also insert into SQLite for tests that might read from it directly
    db.prepare(`
      INSERT INTO agent_executions (id, agent_id, status, task, input, output)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(execId, agentId, 'completed', 'find status', 'in', 'out');

    db.prepare(`
      INSERT INTO tool_executions (tool_name, tool_type, status, duration_ms, agent_execution_id, agent_id, args, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('searchPlaces', 'http', 'completed', 42, execId, agentId, '{"q":"x"}', '{"ok":true}');

    const timeline = await request(app).get(`/api/agent-executions/${execId}/timeline`).expect(200);
    expect(Array.isArray(timeline.body.timeline)).toBe(true);
    expect(timeline.body.timeline.some((x: any) => String(x.stage).startsWith('tool:'))).toBe(true);

    const stream = await request(app).get(`/api/agent-executions/${execId}/stream`).expect(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.text).toContain('event: update');
    expect(stream.text).toContain('event: done');
    expect(stream.text).toContain('"status":"completed"');
  });

  it('supports crew execution status APIs including stream/result, cancel, retry, and resume', async () => {
    const crewId = await createCrew();
    const prisma = getPrisma();
    const completedExec = await prisma.orchestratorCrewExecution.create({
      data: {
        crewId,
        status: 'completed',
        initialInput: 'hello',
        logs: '[]',
      },
    });
    const completedExecId = completedExec.id;

    await prisma.orchestratorCrewExecutionLog.create({
      data: {
        executionId: completedExecId,
        type: 'crew_result',
        payload: JSON.stringify({ result: 'Final synthesized output' }),
      },
    });

    db.prepare(`
      INSERT INTO crew_executions (id, crew_id, status, initial_input, logs, retry_of)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(completedExecId, crewId, 'completed', 'hello', '[]', null);

    db.prepare(`
      INSERT INTO crew_execution_logs (execution_id, type, payload)
      VALUES (?, ?, ?)
    `).run(completedExecId, 'crew_result', JSON.stringify({ result: 'Final synthesized output' }));

    const detail = await request(app).get(`/api/executions/${completedExecId}`).expect(200);
    expect(detail.body.status).toBe('completed');
    expect(Array.isArray(detail.body.logs)).toBe(true);

    const stream = await request(app).get(`/api/executions/${completedExecId}/stream`).expect(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.text).toContain('event: done');
    expect(stream.text).toContain('Final synthesized output');

    const runningExec = await prisma.orchestratorCrewExecution.create({
      data: {
        crewId,
        status: 'running',
        initialInput: 'cancel me',
        logs: '[]',
      },
    });
    const runningExecId = runningExec.id;

    db.prepare(`
      INSERT INTO crew_executions (id, crew_id, status, initial_input, logs, retry_of)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runningExecId, crewId, 'running', 'cancel me', '[]', null);

    await request(app).post(`/api/executions/${runningExecId}/cancel`).expect(200);
    const canceledRow = await prisma.orchestratorCrewExecution.findUnique({ where: { id: runningExecId } });
    expect(canceledRow?.status).toBe('canceled');

    await request(app).post(`/api/executions/${runningExecId}/cancel`).expect(409);

    const retryRes = await request(app).post(`/api/executions/${completedExecId}/retry`).expect(200);
    expect(retryRes.body.executionId).toBeTruthy();
    const retriedRow = await prisma.orchestratorCrewExecution.findUnique({ where: { id: Number(retryRes.body.executionId) } });
    expect(retriedRow?.retryOf).toBe(completedExecId);

    const resumeRes = await request(app).post(`/api/executions/${completedExecId}/resume`).expect(200);
    expect(resumeRes.body.executionId).toBeTruthy();
    const resumedRow = await prisma.orchestratorCrewExecution.findUnique({ where: { id: Number(resumeRes.body.executionId) } });
    expect(resumedRow?.retryOf).toBe(completedExecId);
  });

  it('supports agent sessions API and stop-all cancellation semantics', async () => {
    const agentId = await createAgent('Session Agent');
    const prisma = await ensurePrismaReady();
    const runningExec = await prisma.orchestratorAgentExecution.create({
      data: {
        agentId,
        status: 'running',
        executionKind: 'agent_run',
        task: 'pending task',
        input: 'in',
      },
    });
    const runningExecId = runningExec.id;

    await prisma.orchestratorJobQueue.create({
      data: {
        type: 'run_agent',
        payload: JSON.stringify({ agentId, task: 'queued' }),
        status: 'pending',
      },
    });

    const now = new Date();
    await prisma.orchestratorAgentSession.create({
      data: {
        id: 'sess_1',
        agentId,
        userId: 'user_1',
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      },
    });

    await prisma.orchestratorAgentSessionMemory.create({
      data: {
        sessionId: 'sess_1',
        key: 'conversation',
        value: JSON.stringify([
          { role: 'user', content: 'hello orchestrator' },
          { role: 'assistant', content: 'acknowledged' },
        ]),
        updatedAt: now,
      },
    });

    db.prepare(`
      INSERT INTO agent_executions (id, agent_id, status, task, input, output)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runningExecId, agentId, 'running', 'pending task', 'in', null);

    const sessions = await request(app).get(`/api/agents/${agentId}/sessions`).expect(200);
    expect(sessions.body.length).toBe(1);
    expect(sessions.body[0].message_count).toBe(2);
    expect(String(sessions.body[0].preview)).toContain('acknowledged');

    const messages = await request(app).get(`/api/agents/${agentId}/sessions/sess_1/messages`).expect(200);
    expect(Array.isArray(messages.body.messages)).toBe(true);
    expect(messages.body.messages.length).toBe(2);
    await request(app).get(`/api/agents/${agentId}/sessions/unknown/messages`).expect(404);

    const stopAll = await request(app).post(`/api/agents/${agentId}/stop-all`).expect(200);
    expect(stopAll.body.canceled_running_executions).toBeGreaterThanOrEqual(1);
    expect(stopAll.body.canceled_pending_jobs).toBeGreaterThanOrEqual(1);

    const execRow = await prisma.orchestratorAgentExecution.findUnique({ where: { id: runningExecId } });
    expect(execRow?.status).toBe('canceled');
  });

  it('creates delegated execution trees and finalizes the supervisor after child jobs complete', async () => {
    const supervisorId = await createAgent('Supervisor Agent');
    const workerId = await createAgent('Worker Agent');
    const prisma = getPrisma();

    const kickoff = await request(app)
      .post(`/api/agents/${supervisorId}/delegate`)
      .send({
        task: 'Investigate the request',
        delegate_agent_ids: [workerId],
        synthesize: false,
        wait: false,
      })
      .expect(202);

    const parentExecutionId = Number(kickoff.body.parent_execution_id);
    expect(parentExecutionId).toBeGreaterThan(0);

    const delegation = await prisma.orchestratorAgentDelegation.findFirst({
      where: { parentExecutionId },
    });
    expect(delegation).toBeTruthy();
    expect(delegation?.agentId).toBe(workerId);
    expect(delegation?.childJobId).toBeGreaterThan(0);

    const childExec = await prisma.orchestratorAgentExecution.create({
      data: {
        agentId: workerId,
        status: 'completed',
        executionKind: 'delegated_child',
        parentExecutionId,
        task: 'Investigate the request',
        input: 'child in',
        output: 'child out',
      },
    });

    await prisma.orchestratorJobQueue.update({
      where: { id: delegation!.childJobId },
      data: {
        status: 'completed',
        result: JSON.stringify({ exec_id: childExec.id, result: 'child out', usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } }),
        finishedAt: new Date(),
      },
    });

    for (let i = 0; i < 50; i += 1) {
      const parent = await prisma.orchestratorAgentExecution.findUnique({ where: { id: parentExecutionId } });
      if (parent?.status === 'completed') {
        expect(String(parent.output)).toContain('child out');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (i === 49) {
        throw new Error('Delegated execution did not complete in time');
      }
    }

    const timeline = await request(app).get(`/api/agent-executions/${parentExecutionId}/timeline`).expect(200);
    expect(Array.isArray(timeline.body.delegations)).toBe(true);
    expect(timeline.body.timeline.some((x: any) => String(x.stage).startsWith('delegate:'))).toBe(true);
  });

  it('supports workflow CRUD, execution, and run history for graph-based automation', async () => {
    const prisma = getPrisma();
    const org = await prisma.org.create({ data: { name: 'Test Org' } });
    const project = await prisma.project.create({
      data: { name: 'Workflow Project', description: 'demo', orgId: org.id },
    });
    const projectIdString = project.id;
    // In SQLite, the numeric primary key is expected by some parts of the orchestrator.
    // For tests, we'll use a hash or just an incrementing id if we can, but since the 
    // real app now handles the mapping via project_links, we'll just use a numeric cast if safe, 
    // or a dummy int.
    const projectIdInt = 1001;
    await prisma.orchestratorProject.create({
      data: {
        id: projectIdInt,
        name: 'Workflow Project',
        description: 'demo',
      },
    });

    const tool = await prisma.orchestratorTool.create({
      data: {
        name: 'workflow_echo_tool',
        description: 'Echoes workflow inputs',
        category: 'Automation',
        type: 'custom',
        config: '{}',
      },
    });
    const toolId = tool.id;

    // Also sync to SQLite mirror for CRUD readiness
    db.prepare(`INSERT INTO projects (id, name, description) VALUES (?, ?, ?)`).run(projectIdInt, 'Workflow Project', 'demo');
    // Ensure the project link exists so the app can find the platform project
    await prisma.orchestratorProjectLink.create({
      data: {
        projectId: projectIdInt,
        platformProjectId: projectIdString,
      },
    });
    db.prepare(`INSERT INTO project_links (project_id, platform_project_id) VALUES (?, ?)`).run(projectIdInt, projectIdString);

    db.prepare(`
      INSERT INTO tools (id, name, description, category, type, config)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(toolId, 'workflow_echo_tool', 'Echoes workflow inputs', 'Automation', 'custom', '{}');

    const create = await request(app)
      .post('/api/workflows')
      .send({
        name: 'Workflow Alpha',
        description: 'First workflow',
        status: 'draft',
        trigger_type: 'manual',
        project_id: projectIdInt,

        graph: {
          nodes: [
            { id: 'trigger_1', type: 'trigger', data: { label: 'Trigger', kind: 'trigger' } },
            { id: 'tool_1', type: 'tool', data: { label: 'Tool', kind: 'tool', toolId, argsTemplate: '{"value":"{{input.message}}"}' } },
            { id: 'output_1', type: 'output', data: { label: 'Output', kind: 'output', template: '{{last.text}}' } },
          ],
          edges: [
            { id: 'e1', source: 'trigger_1', target: 'tool_1' },
            { id: 'e2', source: 'tool_1', target: 'output_1' },
          ],
        },
      })
      .expect(200);

    const workflowId = Number(create.body.id);
    expect(workflowId).toBeGreaterThan(0);

    await request(app)
      .put(`/api/workflows/${workflowId}`)
      .send({
        name: 'Workflow Alpha v2',
        description: 'Updated workflow',
        status: 'active',
        trigger_type: 'manual',
        project_id: projectIdInt,
        graph: {
          nodes: [
            { id: 'trigger_1', type: 'trigger', data: { label: 'Trigger', kind: 'trigger' } },
            { id: 'tool_1', type: 'tool', data: { label: 'Tool', kind: 'tool', toolId, argsTemplate: '{"value":"{{input.message}}"}' } },
            { id: 'output_1', type: 'output', data: { label: 'Output', kind: 'output', template: '{{last.text}}' } },
          ],
          edges: [
            { id: 'e1', source: 'trigger_1', target: 'tool_1' },
            { id: 'e2', source: 'tool_1', target: 'output_1' },
          ],
        },
      })
      .expect(200);

    const execute = await request(app)
      .post(`/api/workflows/${workflowId}/execute?wait=true`)
      .send({ input: { message: 'hello workflow' }, wait: true })
      .expect(200);

    expect(execute.body.run_id).toBeTruthy();
    expect(execute.body.status).toBe('completed');
    expect(String(JSON.stringify(execute.body.output))).toContain('workflow_echo_tool');

    const workflow = await request(app).get(`/api/workflows/${workflowId}`).expect(200);
    expect(Array.isArray(workflow.body.runs)).toBe(true);
    expect(workflow.body.runs.length).toBeGreaterThanOrEqual(1);

    const versions = await request(app).get(`/api/workflows/${workflowId}/versions`).expect(200);
    expect(Array.isArray(versions.body.versions)).toBe(true);
    expect(versions.body.versions.length).toBeGreaterThanOrEqual(2);

    const runId = Number(execute.body.run_id);
    const runDetail = await request(app).get(`/api/workflow-runs/${runId}`).expect(200);
    expect(Array.isArray(runDetail.body.logs)).toBe(true);
    expect(runDetail.body.logs.some((log: any) => log.type === 'node_complete')).toBe(true);
  });

  it('streams workflow run snapshots for live workflow observability', async () => {
    const prisma = getPrisma();
    const workflow = await prisma.orchestratorWorkflow.create({
      data: {
        name: 'Streaming Workflow',
        description: 'workflow stream test',
        status: 'active',
        triggerType: 'manual',
        graph: JSON.stringify({
          nodes: [{ id: 'trigger_1', type: 'trigger', data: { label: 'Trigger', kind: 'trigger' } }],
          edges: [],
        }),
        version: 1,
      },
    });
    const workflowId = workflow.id;

    const logs = [
      { ts: new Date().toISOString(), type: 'node_start', payload: { node_id: 'trigger_1', type: 'trigger' } },
      { ts: new Date().toISOString(), type: 'node_complete', payload: { node_id: 'trigger_1', output_preview: '{"input":{"message":"hi"}}' } },
    ];
    const run = await prisma.orchestratorWorkflowRun.create({
      data: {
        workflowId,
        status: 'completed',
        triggerType: 'manual',
        input: JSON.stringify({ message: 'hi' }),
        output: JSON.stringify({ text: 'done' }),
        logs: JSON.stringify(logs),
        graphSnapshot: JSON.stringify({
          nodes: [{ id: 'trigger_1', type: 'trigger', data: { label: 'Trigger', kind: 'trigger' } }],
          edges: [],
        }),
      },
    });
    const runId = run.id;

    // Sync to SQLite for mirror observability if needed
    db.prepare(`
      INSERT INTO workflows (id, name, description, status, trigger_type, graph, version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(workflowId, 'Streaming Workflow', 'workflow stream test', 'active', 'manual', workflow.graph, 1);

    db.prepare(`
      INSERT INTO workflow_runs (id, workflow_id, status, trigger_type, input, output, logs, graph_snapshot, retry_of, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
    `).run(runId, workflowId, 'completed', 'manual', run.input, run.output, run.logs, run.graphSnapshot);

    const stream = await request(app).get(`/api/workflow-runs/${runId}/stream`).expect(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.text).toContain('event: update');
    expect(stream.text).toContain('event: done');
    expect(stream.text).toContain('"status":"completed"');
    expect(stream.text).toContain('"text":"done"');
  });

  it('supports webhook-triggered workflow runs with loop nodes', async () => {
    const workflow = await request(app)
      .post('/api/workflows')
      .send({
        name: 'Webhook Loop Workflow',
        description: 'Processes webhook items',
        status: 'active',
        trigger_type: 'webhook',
        graph: {
          nodes: [
            { id: 'trigger_1', type: 'trigger', data: { label: 'Webhook Trigger', kind: 'trigger' } },
            {
              id: 'loop_1',
              type: 'loop',
              data: {
                label: 'Loop',
                kind: 'loop',
                itemsTemplate: '{{input.items}}',
                itemTemplate: 'Handled {{item}}',
                joinWith: ', ',
              },
            },
            { id: 'output_1', type: 'output', data: { label: 'Output', kind: 'output', template: '{{last.text}}' } },
          ],
          edges: [
            { id: 'e1', source: 'trigger_1', target: 'loop_1' },
            { id: 'e2', source: 'loop_1', target: 'output_1' },
          ],
        },
      })
      .expect(200);

    const workflowId = Number(workflow.body.id);
    const invoke = await request(app)
      .post(`/api/workflows/${workflowId}/webhook?wait=true`)
      .send({ message: 'hello', items: ['ads', 'audiences'] })
      .expect(200);

    expect(invoke.body.status).toBe('completed');
    expect(String(JSON.stringify(invoke.body.output))).toContain('Handled ads');
    expect(String(JSON.stringify(invoke.body.output))).toContain('Handled audiences');

    const runId = Number(invoke.body.run_id);
    const runDetail = await request(app).get(`/api/workflow-runs/${runId}`).expect(200);
    expect(runDetail.body.trigger_type).toBe('webhook');
    expect(runDetail.body.logs.some((log: any) => log.payload?.type === 'loop' || log.payload?.node_id === 'loop_1')).toBe(true);
  });

  it('enforces MCP auth token and validates task-control job cancellation edge cases', async () => {
    const prisma = getPrisma();
    await request(app).put('/api/mcp/config').send({ auth_token: 'demo-token' }).expect(200);
    const cfg = await request(app).get('/api/mcp/config').expect(200);
    expect(cfg.body.auth_token).toBe('demo-token');

    await request(app).post('/mcp').send({}).expect(401);

    const authed = await request(app)
      .post('/mcp')
      .set('X-API-Key', 'demo-token')
      .send({});
    expect(authed.status).not.toBe(401);

    await request(app).post('/api/task-control/jobs/not-a-number/cancel').expect(400);

    const pending = await prisma.orchestratorJobQueue.create({
      data: {
        type: 'run_agent',
        payload: '{}',
        status: 'pending',
      },
    });

    db.prepare(`
      INSERT INTO job_queue (id, type, payload, status)
      VALUES (?, ?, ?, ?)
    `).run(pending.id, 'run_agent', '{}', 'pending');

    await request(app).post(`/api/task-control/jobs/${pending.id}/cancel`).expect(200);

    const running = await prisma.orchestratorJobQueue.create({
      data: {
        type: 'run_agent',
        payload: '{}',
        status: 'running',
      },
    });

    db.prepare(`
      INSERT INTO job_queue (id, type, payload, status)
      VALUES (?, ?, ?, ?)
    `).run(running.id, 'run_agent', '{}', 'running');

    await request(app).post(`/api/task-control/jobs/${running.id}/cancel`).expect(409);
  });
});
