import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import db, { initDb } from '../src/db';
import { ensurePrismaReady, getPrisma } from '../src/platform/prisma';

async function wipeAllDbs() {
  const prisma = await ensurePrismaReady();
  // Wipe Prisma (Primary)
  await prisma.orchestratorAgentExecution.deleteMany({});
  await prisma.orchestratorToolExecution.deleteMany({});
  await prisma.orchestratorJobQueue.deleteMany({});
  await prisma.orchestratorAgentDelegation.deleteMany({});
  await prisma.orchestratorAgentTool.deleteMany({});
  await prisma.orchestratorAgentMcpTool.deleteMany({});
  await prisma.orchestratorAgentMcpBundle.deleteMany({});
  await prisma.orchestratorCrewAgent.deleteMany({});
  await prisma.orchestratorTask.deleteMany({});
  await prisma.orchestratorAgent.deleteMany({});
  await prisma.orchestratorCrew.deleteMany({});
  await prisma.orchestratorTool.deleteMany({});
  await prisma.orchestratorCredential.deleteMany({});
  await prisma.orchestratorLlmProvider.deleteMany({});
  await prisma.modelPricing.deleteMany({});
  await prisma.orchestratorProjectLink.deleteMany({});
  await prisma.orchestratorProject.deleteMany({});
  await prisma.orchestratorSetting.deleteMany({});

  // Wipe and Init SQLite (Mirror)
  initDb();
  const tx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    const tables = [
      'agent_tools',
      'agent_mcp_tools',
      'agent_mcp_bundles',
      'crew_agents',
      'tasks',
      'crew_execution_logs',
      'crew_executions',
      'tool_executions',
      'mcp_bundle_tools',
      'mcp_bundles',
      'mcp_exposed_tools',
      'agent_executions',
      'agents',
      'crews',
      'tools',
      'credentials',
      'llm_providers',
      'model_pricing',
      'project_links',
      'projects',
      'agent_session_memory',
      'agent_sessions',
      'job_queue',
      'settings',
    ];
    for (const table of tables) {
      try { db.prepare(`DELETE FROM ${table}`).run(); } catch {}
    }
    db.pragma('foreign_keys = ON');
  });
  tx();
}

async function createAuthedAgent() {
  const email = `orchestrator_${Date.now()}_${Math.random().toString(16).slice(2)}@test.com`;
  process.env.PLATFORM_ADMIN_EMAILS = email;
  const authed = request.agent(app);
  await authed
    .post('/api/auth/signup')
    .send({
      org_name: 'Orchestrator Test Org',
      email,
      password: 'Password123!',
    })
    .expect(200);
  return authed;
}

describe.sequential('orchestrator local APIs', () => {
  beforeEach(async () => {
    await wipeAllDbs();
  });

  it('supports providers, credentials, pricing, and projects CRUD', async () => {
    const authed = await createAuthedAgent();

    await authed
      .post('/api/credentials')
      .send({
        provider: 'maps_api_key',
        name: 'Maps Key',
        key_name: 'X-API-Key',
        category: 'http',
        api_key: 'secret-123',
      })
      .expect(200);

    const credentials = await authed.get('/api/credentials?category=http').expect(200);
    expect(Array.isArray(credentials.body)).toBe(true);
    expect(credentials.body.length).toBe(1);
    expect(credentials.body[0].provider).toBe('maps_api_key');

    await authed.delete(`/api/credentials/${credentials.body[0].id}`).expect(200);

    const p1 = await authed
      .post('/api/providers')
      .send({
        name: 'OpenAI Primary',
        provider: 'openai',
        api_base: 'https://api.openai.com/v1',
        api_key: 'sk-test',
        is_default: true,
      })
      .expect(200);
    expect(p1.body.id).toBeTruthy();

    const p2 = await authed
      .post('/api/providers')
      .send({
        name: 'OpenAI Backup',
        provider: 'openai',
        api_base: 'https://api.openai.com/v1',
        api_key: 'sk-test-2',
        is_default: true,
      })
      .expect(200);
    expect(p2.body.id).toBeTruthy();

    const providers = await authed.get('/api/providers').expect(200);
    const openaiProviders = providers.body.filter((x: any) => x.provider === 'openai');
    expect(openaiProviders.length).toBe(2);
    expect(openaiProviders.filter((x: any) => Number(x.is_default) === 1).length).toBe(1);

    const pricing = await request(app)
      .post('/api/pricing')
      .send({ model: 'unit-test-model', input_usd: 0.12, output_usd: 0.34 })
      .expect(200);
    expect(pricing.body.id).toBeTruthy();

    await request(app)
      .put(`/api/pricing/${pricing.body.id}`)
      .send({ model: 'unit-test-model-v2', input_usd: 0.22, output_usd: 0.44 })
      .expect(200);

    const pricingRows = await request(app).get('/api/pricing').expect(200);
    expect(pricingRows.body.some((x: any) => x.model === 'unit-test-model-v2')).toBe(true);

    await request(app).delete(`/api/pricing/${pricing.body.id}`).expect(200);

    const project = await authed
      .post('/api/projects')
      .send({ name: 'Core Project', description: 'local project test' })
      .expect(200);
    expect(project.body.id).toBeTruthy();

    const projects = await authed.get('/api/projects').expect(200);
    expect(projects.body.some((x: any) => Number(x.id) === Number(project.body.id))).toBe(true);

    await authed.delete(`/api/projects/${project.body.id}`).expect(200);
  });

  it('supports tools, mcp exposure, bundles, agents, crews, tasks, and task-control flows', async () => {
    const authed = await createAuthedAgent();

    const tool1 = await authed
      .post('/api/tools')
      .send({
        name: 'CurrentDateTimeTool',
        description: 'Returns current timestamp',
        category: 'utility',
        type: 'custom',
        config: {},
      })
      .expect(200);
    const tool2 = await authed
      .post('/api/tools')
      .send({
        name: 'SearchPlaces',
        description: 'Searches for places',
        category: 'maps',
        type: 'custom',
        config: {},
      })
      .expect(200);

    await authed
      .put(`/api/mcp/exposed-tools/${tool1.body.id}`)
      .send({ exposed: true, exposed_name: 'tool_currentdatetimetool', description: 'datetime exposure' })
      .expect(200);

    const exposed = await authed.get('/api/mcp/exposed-tools').expect(200);
    const exposedRow = exposed.body.find((x: any) => Number(x.tool_id) === Number(tool1.body.id));
    expect(exposedRow.exposed_name).toBe('currentdatetimetool');

    const bundle = await authed
      .post('/api/mcp/bundles')
      .send({
        name: 'Core Bundle',
        slug: 'core_bundle',
        description: 'bundle for tests',
        tool_ids: [Number(tool1.body.id), Number(tool2.body.id)],
      })
      .expect(200);
    expect(bundle.body.id).toBeTruthy();

    const manifest = await authed.get('/mcp/manifest').expect(200);
    expect(Array.isArray(manifest.body.tools)).toBe(true);
    expect(manifest.body.tools.some((x: any) => x.name === 'bundle_core_bundle')).toBe(true);
    expect(Array.isArray(manifest.body.bundles)).toBe(true);
    const manifestBundle = manifest.body.bundles.find((x: any) => x.slug === 'core_bundle');
    expect(manifestBundle).toBeTruthy();
    expect(String(manifestBundle.streamable_http_url)).toContain('/mcp/bundle/core_bundle');
    expect(Array.isArray(manifestBundle.tools)).toBe(true);
    expect(manifestBundle.tools.length).toBeGreaterThanOrEqual(2);

    const bundleInventory = await authed
      .post('/mcp/call/bundle_core_bundle')
      .send({})
      .expect(200);
    expect(String(bundleInventory.body.content?.[0]?.text || '')).toContain('"slug": "core_bundle"');
    expect(String(bundleInventory.body.content?.[0]?.text || '')).toContain('CurrentDateTimeTool');

    const agent1 = await authed
      .post('/api/agents')
      .send({
        name: 'Coordinator Agent',
        role: 'Planner',
        goal: 'Coordinate multi-agent work',
        backstory: 'Test coordinator',
        provider: 'google',
        model: 'gemini-1.5-flash',
        toolIds: [Number(tool1.body.id)],
        mcp_tool_ids: [Number(tool1.body.id)],
        mcp_bundle_ids: [Number(bundle.body.id)],
      })
      .expect(200);
    const agent2 = await authed
      .post('/api/agents')
      .send({
        name: 'Specialist Agent',
        role: 'Executor',
        goal: 'Execute assigned tasks',
        backstory: 'Test specialist',
        provider: 'google',
        model: 'gemini-1.5-flash',
      })
      .expect(200);

    const agentWithDefaults = await authed
      .post('/api/agents')
      .send({
        name: 'Defaults Agent',
        role: 'Generalist',
        provider: 'google',
        model: 'gemini-1.5-flash',
      })
      .expect(200);
    expect(agentWithDefaults.body.id).toBeTruthy();

    await authed
      .post('/api/agents')
      .send({ role: 'Invalid' })
      .expect(400);

    const agents = await authed.get('/api/agents').expect(200);
    const createdAgent = agents.body.find((x: any) => Number(x.id) === Number(agent1.body.id));
    expect(createdAgent).toBeTruthy();
    expect(Array.isArray(createdAgent.tools)).toBe(true);
    expect(createdAgent.tools.some((t: any) => Number(t.id) === Number(tool1.body.id))).toBe(true);
    expect(createdAgent.mcp_tool_ids.includes(Number(tool1.body.id))).toBe(true);
    expect(createdAgent.mcp_bundle_ids.includes(Number(bundle.body.id))).toBe(true);

    const crew = await authed
      .post('/api/crews')
      .send({
        name: 'Hierarchy Crew',
        description: 'crew for orchestration test',
        process: 'hierarchical',
        agentIds: [Number(agent1.body.id), Number(agent2.body.id)],
        coordinator_agent_id: Number(agent1.body.id),
      })
      .expect(200);
    expect(crew.body.id).toBeTruthy();

    const crews = await authed.get('/api/crews').expect(200);
    const createdCrew = crews.body.find((x: any) => Number(x.id) === Number(crew.body.id));
    expect(createdCrew).toBeTruthy();
    expect(createdCrew.process).toBe('hierarchical');
    expect(Number(createdCrew.coordinator_agent_id)).toBe(Number(agent1.body.id));

    const tasksInitial = await authed.get(`/api/tasks?crew_id=${crew.body.id}`).expect(200);
    expect(Array.isArray(tasksInitial.body)).toBe(true);
    expect(tasksInitial.body.length).toBeGreaterThanOrEqual(2);

    const firstTask = tasksInitial.body[0];
    await authed
      .put(`/api/tasks/${firstTask.id}`)
      .send({
        description: 'Updated description',
        expected_output: firstTask.expected_output,
        agent_id: firstTask.agent_id,
      })
      .expect(200);

    const manualTask = await authed
      .post('/api/tasks')
      .send({
        description: 'Manual task',
        expected_output: 'Manual output',
        agent_id: Number(agent2.body.id),
        crew_id: Number(crew.body.id),
      })
      .expect(200);
    expect(manualTask.body.id).toBeTruthy();

    await authed
      .delete(`/api/tasks/${manualTask.body.id}`)
      .expect(200);

    await authed
      .put(`/api/crews/${crew.body.id}`)
      .send({
        name: 'Hierarchy Crew v2',
        description: 'updated',
        process: 'hierarchical',
        agentIds: [Number(agent1.body.id), Number(agent2.body.id)],
        coordinator_agent_id: Number(agent2.body.id),
      })
      .expect(200);

    const taskControl = await authed.get('/api/task-control').expect(200);
    expect(Array.isArray(taskControl.body.runningAgentExecutions)).toBe(true);
    expect(Array.isArray(taskControl.body.runningCrewExecutions)).toBe(true);
    expect(Array.isArray(taskControl.body.pendingJobs)).toBe(true);

    await authed.post('/api/task-control/stop-running-agents').expect(200);
    await authed.post('/api/task-control/stop-running-crews').expect(200);
    await authed.post('/api/task-control/cancel-pending-jobs').expect(200);

    await authed.delete(`/api/agents/${agent1.body.id}`).expect(200);
    await authed.delete(`/api/agents/${agent2.body.id}`).expect(200);
    await authed.delete(`/api/agents/${agentWithDefaults.body.id}`).expect(200);
    await authed.delete(`/api/crews/${crew.body.id}`).expect(200);

    await authed.delete(`/api/tools/${tool1.body.id}`).expect(200);
    await authed.delete(`/api/tools/${tool2.body.id}`).expect(200);
    await authed.delete(`/api/mcp/bundles/${bundle.body.id}`).expect(200);
  });
});
