import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../src/platform/prisma';
import { hashPassword } from '../src/platform/auth';
import { createProjectApiKey } from '../src/platform/apiKeys';
import { randomTraceIdHex32, uuid } from '../src/platform/crypto';

async function main() {
  const prisma = getPrisma();

  const orgName = process.env.SEED_ORG_NAME || 'Demo Org';
  const email = (process.env.SEED_EMAIL || 'demo@example.com').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'password123';
  const projectName = process.env.SEED_PROJECT_NAME || 'Demo Project';

  let user = await prisma.user.findFirst({ where: { email } });
  let orgId = user?.orgId;

  if (!orgId) {
    const org = await prisma.org.create({ data: { name: orgName } });
    orgId = org.id;
  }

  await prisma.role.createMany({
    data: ['owner', 'admin', 'member', 'viewer'].map((name) => ({ orgId: orgId!, name })),
    skipDuplicates: true,
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        orgId: orgId!,
        email,
        passwordHash: await hashPassword(password),
      },
    });
  } else {
    // Reset password so "Invalid credentials" issues are easy to recover from in dev.
    user = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  const nowDate = new Date();
  let session = await prisma.session.findFirst({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: nowDate } },
    orderBy: { createdAt: 'desc' },
  });
  if (!session) {
    session = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
  }

  const ownerRole = await prisma.role.findFirst({ where: { orgId: orgId!, name: 'owner' } });
  if (ownerRole) {
    await prisma.userRole
      .create({ data: { userId: user.id, roleId: ownerRole.id } })
      .catch(() => undefined);
  }

  let project = await prisma.project.findFirst({ where: { orgId: orgId!, name: projectName } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        orgId: orgId!,
        name: projectName,
        description: 'Seeded project',
      },
    });
  }

  const { rawKey } = await createProjectApiKey({ projectId: project.id, name: 'Seed Key' });

  // Seed pricing (matches legacy constants; adjust as needed)
  await prisma.modelPricing.createMany({
    data: [
      { model: 'gemini-3-flash-preview', inputUsd: 0.075, outputUsd: 0.30 },
      { model: 'gemini-3.1-pro-preview', inputUsd: 1.25, outputUsd: 5.00 },
      { model: 'gemini-2.5-flash-latest', inputUsd: 0.075, outputUsd: 0.30 },
      { model: 'gemini-flash-lite-latest', inputUsd: 0.05, outputUsd: 0.20 },
      { model: 'gpt-4o', inputUsd: 2.50, outputUsd: 10.00 },
      { model: 'gpt-4o-mini', inputUsd: 0.15, outputUsd: 0.60 },
      { model: 'gpt-4-turbo', inputUsd: 10.00, outputUsd: 30.00 },
      { model: 'gpt-3.5-turbo', inputUsd: 0.50, outputUsd: 1.50 },
      { model: 'o1-preview', inputUsd: 15.00, outputUsd: 60.00 },
      { model: 'o1-mini', inputUsd: 3.00, outputUsd: 12.00 },
      { model: 'claude-3-5-sonnet-20240620', inputUsd: 3.00, outputUsd: 15.00 },
      { model: 'claude-3-5-haiku-20241022', inputUsd: 1.00, outputUsd: 5.00 },
      { model: 'claude-3-opus-20240229', inputUsd: 15.00, outputUsd: 75.00 },
      { model: 'claude-3-haiku-20240307', inputUsd: 0.25, outputUsd: 1.25 },
    ],
    skipDuplicates: true,
  });

  const now = Date.now();
  const release = `web@${new Date(now).toISOString().slice(0, 10)}`;

  async function ensureRun(params: {
    name: string;
    kind: string;
    status: string;
    startedAt: Date;
    endedAt?: Date;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalCostUsd?: number;
    environment?: string;
    parentRunId?: string;
    error?: Prisma.JsonObject;
    tags?: Prisma.JsonObject;
  }) {
    const existing = await prisma.run.findFirst({
      where: { projectId: project.id, name: params.name, kind: params.kind },
    });
    if (existing) return existing.id;

    const runId = uuid();
    await prisma.run.create({
      data: {
        id: runId,
        orgId: orgId!,
        projectId: project.id,
        kind: params.kind,
        name: params.name,
        status: params.status,
        startedAt: params.startedAt,
        endedAt: params.endedAt,
        durationMs: params.durationMs,
        promptTokens: params.promptTokens ?? 0,
        completionTokens: params.completionTokens ?? 0,
        totalCostUsd: params.totalCostUsd ?? 0,
        environment: params.environment,
        release,
        traceId: randomTraceIdHex32(),
        parentRunId: params.parentRunId,
        tags: { seeded: true, ...(params.tags ?? {}) },
        error: params.error ?? null,
      },
    });
    return runId;
  }

  const workflowRunId = await ensureRun({
    name: 'Customer support workflow',
    kind: 'workflow_run',
    status: 'completed',
    startedAt: new Date(now - 90_000),
    endedAt: new Date(now - 76_000),
    durationMs: 14_000,
    promptTokens: 842,
    completionTokens: 611,
    totalCostUsd: 0.018432,
    environment: 'prod',
    tags: { feature: 'routing', priority: 'p1', sessionId: session.id },
  });

  const childRunId = await ensureRun({
    name: 'Resolve policy dispute',
    kind: 'agent_run',
    status: 'completed',
    startedAt: new Date(now - 88_000),
    endedAt: new Date(now - 78_500),
    durationMs: 9_500,
    promptTokens: 312,
    completionTokens: 228,
    totalCostUsd: 0.006021,
    environment: 'prod',
    parentRunId: workflowRunId,
    tags: { agent: 'policy-router', tool: 'knowledge_base', sessionId: session.id },
  });

  const failedRunId = await ensureRun({
    name: 'Draft refund summary',
    kind: 'agent_run',
    status: 'failed',
    startedAt: new Date(now - 70_000),
    endedAt: new Date(now - 67_800),
    durationMs: 2_200,
    promptTokens: 190,
    completionTokens: 0,
    totalCostUsd: 0.001113,
    environment: 'prod',
    error: {
      code: 'TOOL_TIMEOUT',
      message: 'Knowledge base search timed out after 2s',
      retryable: true,
    },
    tags: { agent: 'refund-assistant', sessionId: session.id },
  });

  const runningRunId = await ensureRun({
    name: 'Live chat escalation',
    kind: 'workflow_run',
    status: 'running',
    startedAt: new Date(now - 25_000),
    environment: 'staging',
    tags: { feature: 'escalation', channel: 'chat', sessionId: session.id },
  });

  async function ensureRunEvents(runId: string, events: Array<Record<string, unknown>>) {
    const count = await prisma.runEvent.count({ where: { runId } });
    if (count > 0) return;
    await prisma.runEvent.createMany({
      data: events.map((event) => ({ id: uuid(), runId, ...event })) as Prisma.RunEventCreateManyInput[],
      skipDuplicates: true,
    });
  }

  await ensureRunEvents(workflowRunId, [
    { type: 'span_start', name: 'triage', ts: new Date(now - 89_500), spanId: 'span-triage' },
    {
      type: 'log',
      name: 'intent',
      inputText: 'Customer wants refund on order 18421',
      outputText: 'Routing to refund flow',
      ts: new Date(now - 88_900),
      parentSpanId: 'span-triage',
    },
    {
      type: 'span_end',
      name: 'triage',
      status: 'completed',
      durationMs: 1_400,
      ts: new Date(now - 88_100),
      spanId: 'span-triage',
    },
    { type: 'span_start', name: 'policy', ts: new Date(now - 87_800), spanId: 'span-policy' },
    {
      type: 'span_end',
      name: 'policy',
      status: 'completed',
      durationMs: 7_200,
      ts: new Date(now - 80_600),
      spanId: 'span-policy',
    },
    {
      type: 'span_end',
      name: 'workflow',
      status: 'completed',
      durationMs: 14_000,
      ts: new Date(now - 76_000),
    },
  ]);

  await ensureRunEvents(childRunId, [
    { type: 'span_start', name: 'agent', ts: new Date(now - 88_000), spanId: 'span-agent' },
    {
      type: 'log',
      name: 'tool_call',
      inputText: 'search_kb: "refund policy 2025"',
      outputText: '3 documents returned',
      ts: new Date(now - 86_900),
      parentSpanId: 'span-agent',
      attributes: {
        tool: 'knowledge_base',
        hits: 3,
        memory: {
          key: 'customer_profile',
          value: 'VIP - prefers phone follow-up',
          scope: 'session',
          sessionId: session.id,
        },
      },
    },
    {
      type: 'span_end',
      name: 'agent',
      status: 'completed',
      durationMs: 9_500,
      ts: new Date(now - 78_500),
      spanId: 'span-agent',
    },
  ]);

  await ensureRunEvents(failedRunId, [
    { type: 'span_start', name: 'agent', ts: new Date(now - 70_000), spanId: 'span-failed' },
    {
      type: 'span_end',
      name: 'agent',
      status: 'failed',
      durationMs: 2_200,
      ts: new Date(now - 67_800),
      spanId: 'span-failed',
      error: { message: 'Tool timeout', code: 'TOOL_TIMEOUT' },
    },
  ]);

  await ensureRunEvents(runningRunId, [
    { type: 'span_start', name: 'workflow', ts: new Date(now - 25_000), spanId: 'span-live' },
    {
      type: 'log',
      name: 'queued',
      inputText: 'Escalating to tier-2 agent',
      outputText: 'Queue: tier-2',
      ts: new Date(now - 23_000),
      parentSpanId: 'span-live',
    },
  ]);

  // eslint-disable-next-line no-console
  console.log('Seed complete');
  // eslint-disable-next-line no-console
  console.log(`Org: ${orgId} (${orgName})`);
  // eslint-disable-next-line no-console
  console.log(`User: ${user.email} / ${password}`);
  // eslint-disable-next-line no-console
  console.log(`Session: ${session.id} (expires ${session.expiresAt.toISOString()})`);
  // eslint-disable-next-line no-console
  console.log(`Project: ${project.id} (${project.name})`);
  // eslint-disable-next-line no-console
  console.log(`API key (store this): ${rawKey}`);
  // eslint-disable-next-line no-console
  console.log(`Optional: set PLATFORM_PROJECT_API_KEY=${rawKey} to dogfood internal runs -> platform`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
