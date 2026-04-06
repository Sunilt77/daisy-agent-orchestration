import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { ensurePrismaReady, getPrisma } from '../src/platform/prisma';

const prisma = getPrisma();

async function wipeDb() {
  await ensurePrismaReady();
  // Order matters due to FKs.
  await prisma.runEvent.deleteMany();
  await prisma.run.deleteMany();
  await prisma.projectApiKey.deleteMany();
  await prisma.project.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.session.deleteMany();
  await prisma.role.deleteMany();
  await prisma.user.deleteMany();
  await prisma.org.deleteMany();
}

describe('platform', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for tests (start Postgres + run prisma migrations)');
    }
  });

  beforeEach(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@acme.com';
    await wipeDb();
  });

  it('signs up, creates project, issues key, ingests run/events', async () => {
    const agent = request.agent(app);

    // signup
    const signup = await agent
      .post('/api/auth/signup')
      .send({ org_name: 'Acme', email: 'owner@acme.com', password: 'Password123!' })
      .expect(200);
    expect(signup.body.user.email).toBe('owner@acme.com');

    // create project
    const project = await agent
      .post('/api/v1/projects')
      .send({ name: 'Prod', description: 'prod env' })
      .expect(200);
    expect(project.body.id).toBeTruthy();

    // create api key
    const key = await agent
      .post('/api/v1/api-keys')
      .send({ project_id: project.body.id, name: 'ingest' })
      .expect(200);
    expect(key.body.api_key).toMatch(/^ak_/);

    // ingest run via API key
    const run = await request(app)
      .post('/api/v1/runs')
      .set('Authorization', `Bearer ${key.body.api_key}`)
      .send({ kind: 'agent_run', name: 'test run' })
      .expect(200);
    expect(run.body.run_id).toBeTruthy();
    expect(run.body.trace_id).toMatch(/^[0-9a-f]{32}$/);

    // append events + idempotency
    const eventId = '11111111-1111-1111-1111-111111111111';
    const batch = {
      events: [
        {
          event_id: eventId,
          type: 'llm_call',
          name: 'llm_call',
          attributes: { llm: { prompt_tokens: 1, completion_tokens: 2, cost_usd: 0.01 } },
        },
      ],
    };

    const inserted1 = await request(app)
      .post(`/api/v1/runs/${run.body.run_id}/events`)
      .set('Authorization', `Bearer ${key.body.api_key}`)
      .send(batch)
      .expect(200);
    expect(inserted1.body.inserted).toBe(1);

    const inserted2 = await request(app)
      .post(`/api/v1/runs/${run.body.run_id}/events`)
      .set('Authorization', `Bearer ${key.body.api_key}`)
      .send(batch)
      .expect(200);
    expect(inserted2.body.inserted).toBe(0);

    // list runs via session auth
    const runs = await agent
      .get(`/api/v1/runs?project_id=${encodeURIComponent(project.body.id)}`)
      .expect(200);
    expect(runs.body.length).toBe(1);
    expect(runs.body[0].promptTokens).toBe(1);
    expect(runs.body[0].completionTokens).toBe(2);
  });

  it('supports platform admin governance for plans, tenant policy overrides, and session limits', async () => {
    const admin = request.agent(app);

    await admin
      .post('/api/auth/signup')
      .send({ org_name: 'Acme', email: 'owner@acme.com', password: 'Password123!' })
      .expect(200);

    await request(app)
      .post('/api/auth/signup')
      .send({ org_name: 'Beta', email: 'owner2@beta.com', password: 'Password123!' })
      .expect(200);

    const tenants = await admin.get('/api/admin/tenants').expect(200);
    expect(Array.isArray(tenants.body)).toBe(true);
    expect(tenants.body.length).toBe(2);
    const acme = tenants.body.find((t: any) => t.name === 'Acme');
    expect(acme).toBeTruthy();
    expect(acme.usage).toBeTruthy();

    const createdPlan = await admin.post('/api/admin/plans').send({
      name: 'Starter',
      daily_message_cap: 50,
      rate_limit_per_second: 5,
      max_agents: 3,
      max_linked_mcp_bundles: 2,
      max_active_sessions_per_user: 1,
    }).expect(200);
    expect(createdPlan.body.id).toBeTruthy();

    await admin
      .post(`/api/admin/tenants/${acme.id}/assign-plan`)
      .send({ plan_id: createdPlan.body.id })
      .expect(200);

    const policy = await admin
      .patch(`/api/admin/tenants/${acme.id}/policy`)
      .send({ max_agents: 2, max_active_sessions_per_user: 1 })
      .expect(200);
    expect(policy.body.policy.max_agents).toBe(2);

    const loginAgain = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@acme.com', password: 'Password123!' });
    expect(loginAgain.status).toBe(200);

    const user = await prisma.user.findFirst({ where: { email: 'owner@acme.com' } });
    expect(user).toBeTruthy();
    const activeSessionCount = await prisma.session.count({
      where: { userId: user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(activeSessionCount).toBe(1);
  });
});
