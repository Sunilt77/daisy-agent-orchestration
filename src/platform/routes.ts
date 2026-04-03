import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ensurePrismaReady, getPrisma } from './prisma';
import { asHttpError, HttpError } from './httpErrors';
import { clearSessionCookie, getSessionDays, hashPassword, requireUser, setSessionCookie, verifyPassword } from './auth';
import { createProjectApiKey, verifyProjectApiKey } from './apiKeys';
import { randomTraceIdHex32, uuid } from './crypto';
import { ssePublish, sseSubscribe } from './sse';
import db from '../db';
import { syncPersistentMirrorFromPostgres } from '../orchestrator/sqliteMirror';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const PLATFORM_SETTINGS_KEY = 'platform_admin_settings_v1';
const PLATFORM_PLANS_KEY = 'platform_admin_plans_v1';
const PLATFORM_PLAN_ASSIGNMENTS_KEY = 'platform_org_plan_map_v1';
const PLATFORM_ORG_OVERRIDES_KEY = 'platform_org_policy_overrides_v1';
const PLATFORM_ORG_STATUS_KEY = 'platform_org_status_v1';
const PLATFORM_ACCESS_CONTROLS_KEY = 'platform_access_controls_v1';

type PlatformPlan = {
  id: string;
  name: string;
  description?: string;
  credit_limit: number;
  contact_limit: number;
  max_users: number;
  max_numbers: number;
  daily_message_cap: number;
  batch_size: number;
  rate_limit_per_second?: number;
  max_agents?: number;
  max_crews?: number;
  max_linked_tools?: number;
  max_linked_mcp_tools?: number;
  max_linked_mcp_bundles?: number;
  max_active_sessions_per_user?: number;
  max_active_sessions_org?: number;
  price: number;
  is_active?: boolean;
};

type OrgPolicy = {
  daily_message_cap?: number;
  batch_size?: number;
  rate_limit_per_second?: number;
  max_users?: number;
  max_numbers?: number;
  contact_limit?: number;
  credit_limit?: number;
  max_agents?: number;
  max_crews?: number;
  max_linked_tools?: number;
  max_linked_mcp_tools?: number;
  max_linked_mcp_bundles?: number;
  max_active_sessions_per_user?: number;
  max_active_sessions_org?: number;
};

type AccessMode = 'all' | 'none' | 'allowlist';
type AccessPolicy = {
  agents_mode?: 'all' | 'none' | 'allowlist';
  allowed_agent_ids?: number[];
  tools_mode?: AccessMode;
  mcp_mode?: AccessMode;
  allowed_tool_ids?: number[];
  allowed_mcp_tool_ids?: number[];
  allowed_mcp_bundle_ids?: number[];
};

type AccessControlsStore = {
  global: AccessPolicy;
  tenants: Record<string, AccessPolicy>;
};

type EmbeddingConfig = {
  provider: 'google' | 'openai' | 'anthropic';
  model: string;
};

const DEFAULT_PLATFORM_SETTINGS = {
  daily_message_cap: 1000,
  batch_size: 50,
  rate_limit_per_second: 10,
  max_agents: 100,
  max_crews: 50,
  max_linked_tools: 200,
  max_linked_mcp_tools: 100,
  max_linked_mcp_bundles: 100,
  max_active_sessions_per_user: 5,
  max_active_sessions_org: 500,
};

function getJsonSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  if (!row?.value) return fallback;
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return fallback;
  }
}

async function setJsonSetting<T>(key: string, value: T) {
  const prisma = await ensurePrismaReady();
  await prisma.orchestratorSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
  await syncPersistentMirrorFromPostgres();
}

function getPlatformSettings() {
  const raw = getJsonSetting<Record<string, any>>(PLATFORM_SETTINGS_KEY, DEFAULT_PLATFORM_SETTINGS);
  return {
    ...DEFAULT_PLATFORM_SETTINGS,
    ...(raw || {}),
  };
}

function sanitizeIdList(input: any): number[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
}

function resolveDefaultEmbeddingConfig(): EmbeddingConfig {
  const googleEnvKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (googleEnvKey) {
    return { provider: 'google', model: 'text-embedding-004' };
  }
  const openaiEnvKey = (process.env.OPENAI_API_KEY || '').trim();
  if (openaiEnvKey) {
    return { provider: 'openai', model: 'text-embedding-3-small' };
  }

  try {
    const provider = db.prepare(
      'SELECT provider FROM llm_providers WHERE COALESCE(TRIM(api_key), \'\') <> \'\' ORDER BY is_default DESC, id ASC LIMIT 1',
    ).get() as any;
    const value = String(provider?.provider || '').toLowerCase();
    if (value === 'google') return { provider: 'google', model: 'text-embedding-004' };
    if (value === 'openai') return { provider: 'openai', model: 'text-embedding-3-small' };
  } catch {}

  throw new HttpError(400, 'No embedding provider key configured. Set GOOGLE_API_KEY (or GEMINI_API_KEY) or OPENAI_API_KEY.');
}

function normalizeAccessPolicy(input: any, fallback?: AccessPolicy): AccessPolicy {
  const base = fallback || {};
  const agentsMode = input?.agents_mode === 'allowlist' || input?.agents_mode === 'none' || input?.agents_mode === 'all'
    ? input.agents_mode
    : (base.agents_mode || 'all');
  const toolsMode = input?.tools_mode === 'allowlist' || input?.tools_mode === 'none' || input?.tools_mode === 'all'
    ? input.tools_mode
    : (base.tools_mode || 'all');
  const mcpMode = input?.mcp_mode === 'allowlist' || input?.mcp_mode === 'none' || input?.mcp_mode === 'all'
    ? input.mcp_mode
    : (base.mcp_mode || 'all');
  return {
    agents_mode: agentsMode,
    allowed_agent_ids: sanitizeIdList(input?.allowed_agent_ids ?? base.allowed_agent_ids),
    tools_mode: toolsMode,
    mcp_mode: mcpMode,
    allowed_tool_ids: sanitizeIdList(input?.allowed_tool_ids ?? base.allowed_tool_ids),
    allowed_mcp_tool_ids: sanitizeIdList(input?.allowed_mcp_tool_ids ?? base.allowed_mcp_tool_ids),
    allowed_mcp_bundle_ids: sanitizeIdList(input?.allowed_mcp_bundle_ids ?? base.allowed_mcp_bundle_ids),
  };
}

function getAccessControlsStore(): AccessControlsStore {
  const raw = getJsonSetting<any>(PLATFORM_ACCESS_CONTROLS_KEY, {});
  const global = normalizeAccessPolicy(raw?.global || {}, {
    agents_mode: 'all',
    tools_mode: 'all',
    mcp_mode: 'all',
    allowed_agent_ids: [],
    allowed_tool_ids: [],
    allowed_mcp_tool_ids: [],
    allowed_mcp_bundle_ids: [],
  });
  const tenants: Record<string, AccessPolicy> = {};
  const rawTenants = raw?.tenants && typeof raw.tenants === 'object' ? raw.tenants : {};
  for (const [orgId, policy] of Object.entries(rawTenants)) {
    tenants[String(orgId)] = normalizeAccessPolicy(policy || {}, {});
  }
  return { global, tenants };
}

async function setAccessControlsStore(store: AccessControlsStore) {
  await setJsonSetting(PLATFORM_ACCESS_CONTROLS_KEY, {
    global: normalizeAccessPolicy(store.global || {}, {
      agents_mode: 'all',
      tools_mode: 'all',
      mcp_mode: 'all',
      allowed_agent_ids: [],
      allowed_tool_ids: [],
      allowed_mcp_tool_ids: [],
      allowed_mcp_bundle_ids: [],
    }),
    tenants: store.tenants || {},
  });
}

function getPlatformAdminEmails() {
  const raw = String(process.env.PLATFORM_ADMIN_EMAILS || '').trim();
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function requirePlatformAdmin(req: Request) {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  const admins = getPlatformAdminEmails();
  if (!admins.length) throw new HttpError(403, 'Platform admin is not configured');
  const isAdmin = admins.includes(req.user.email.toLowerCase());
  if (!isAdmin) throw new HttpError(403, 'Platform admin access required');
}

async function getResolvedOrgPolicy(orgId: string): Promise<OrgPolicy> {
  const settings = getPlatformSettings();
  const plans = getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []);
  const assignments = getJsonSetting<Record<string, string>>(PLATFORM_PLAN_ASSIGNMENTS_KEY, {});
  const overrides = getJsonSetting<Record<string, OrgPolicy>>(PLATFORM_ORG_OVERRIDES_KEY, {});
  const assignedPlanId = assignments[orgId];
  const assignedPlan = plans.find((p) => p.id === assignedPlanId && p.is_active !== false);

  return {
    daily_message_cap: overrides[orgId]?.daily_message_cap ?? assignedPlan?.daily_message_cap ?? settings.daily_message_cap,
    batch_size: overrides[orgId]?.batch_size ?? assignedPlan?.batch_size ?? settings.batch_size,
    rate_limit_per_second: overrides[orgId]?.rate_limit_per_second ?? assignedPlan?.rate_limit_per_second ?? settings.rate_limit_per_second,
    max_users: overrides[orgId]?.max_users ?? assignedPlan?.max_users,
    max_numbers: overrides[orgId]?.max_numbers ?? assignedPlan?.max_numbers,
    contact_limit: overrides[orgId]?.contact_limit ?? assignedPlan?.contact_limit,
    credit_limit: overrides[orgId]?.credit_limit ?? assignedPlan?.credit_limit,
    max_agents: overrides[orgId]?.max_agents ?? assignedPlan?.max_agents ?? settings.max_agents,
    max_crews: overrides[orgId]?.max_crews ?? assignedPlan?.max_crews ?? settings.max_crews,
    max_linked_tools: overrides[orgId]?.max_linked_tools ?? assignedPlan?.max_linked_tools ?? settings.max_linked_tools,
    max_linked_mcp_tools: overrides[orgId]?.max_linked_mcp_tools ?? assignedPlan?.max_linked_mcp_tools ?? settings.max_linked_mcp_tools,
    max_linked_mcp_bundles: overrides[orgId]?.max_linked_mcp_bundles ?? assignedPlan?.max_linked_mcp_bundles ?? settings.max_linked_mcp_bundles,
    max_active_sessions_per_user: overrides[orgId]?.max_active_sessions_per_user ?? assignedPlan?.max_active_sessions_per_user ?? settings.max_active_sessions_per_user,
    max_active_sessions_org: overrides[orgId]?.max_active_sessions_org ?? assignedPlan?.max_active_sessions_org ?? settings.max_active_sessions_org,
  };
}

type TenantUsage = {
  local_projects_count: number;
  agents_count: number;
  crews_count: number;
  linked_tools_count: number;
  linked_mcp_tools_count: number;
  linked_mcp_bundles_count: number;
  agent_executions_count: number;
  crew_executions_count: number;
  tool_executions_count: number;
  platform_runs_count: number;
  platform_events_count: number;
};

function emptyTenantUsage(): TenantUsage {
  return {
    local_projects_count: 0,
    agents_count: 0,
    crews_count: 0,
    linked_tools_count: 0,
    linked_mcp_tools_count: 0,
    linked_mcp_bundles_count: 0,
    agent_executions_count: 0,
    crew_executions_count: 0,
    tool_executions_count: 0,
    platform_runs_count: 0,
    platform_events_count: 0,
  };
}

function getCountForProjectIds(sql: string, projectIds: number[]): number {
  if (!projectIds.length) return 0;
  const placeholders = projectIds.map(() => '?').join(',');
  const row = db.prepare(sql.replace('__IN__', placeholders)).get(...projectIds) as any;
  return Number(row?.count || 0);
}

async function getTenantUsageMap(orgIds: string[], prisma: ReturnType<typeof getPrisma>): Promise<Map<string, TenantUsage>> {
  const map = new Map<string, TenantUsage>();
  orgIds.forEach((orgId) => map.set(orgId, emptyTenantUsage()));

  if (!orgIds.length) return map;

  const linkRows = db.prepare(`
    SELECT id as project_id, platform_project_id
    FROM projects
    WHERE platform_project_id IS NOT NULL AND platform_project_id != ''
    UNION
    SELECT project_id, platform_project_id
    FROM project_links
    WHERE project_id NOT IN (
      SELECT id FROM projects WHERE platform_project_id IS NOT NULL AND platform_project_id != ''
    )
  `).all() as Array<{ project_id: number; platform_project_id: string }>;
  const platformProjectIds = Array.from(new Set(linkRows.map((r) => String(r.platform_project_id)).filter(Boolean)));
  const platformProjects = platformProjectIds.length
    ? await prisma.project.findMany({ where: { id: { in: platformProjectIds } }, select: { id: true, orgId: true } })
    : [];
  const platformProjectToOrg = new Map(platformProjects.map((p) => [p.id, p.orgId]));
  const orgToLocalProjectIds = new Map<string, number[]>();
  for (const row of linkRows) {
    const orgId = platformProjectToOrg.get(String(row.platform_project_id));
    if (!orgId) continue;
    if (!orgToLocalProjectIds.has(orgId)) orgToLocalProjectIds.set(orgId, []);
    orgToLocalProjectIds.get(orgId)!.push(Number(row.project_id));
  }

  const [runsByOrg, eventCounts] = await Promise.all([
    prisma.run.groupBy({
      by: ['orgId'],
      where: { orgId: { in: orgIds } },
      _count: { _all: true },
    }),
    Promise.all(orgIds.map(async (orgId) => ({
      orgId,
      count: await prisma.runEvent.count({ where: { run: { orgId } } }),
    }))),
  ]);
  const runCountByOrg = new Map(runsByOrg.map((r) => [r.orgId, Number(r._count._all || 0)]));
  const eventCountByOrg = new Map(eventCounts.map((r) => [r.orgId, Number(r.count || 0)]));

  for (const orgId of orgIds) {
    const usage = map.get(orgId)!;
    const projectIds = orgToLocalProjectIds.get(orgId) || [];
    usage.local_projects_count = projectIds.length;
    usage.agents_count = getCountForProjectIds('SELECT COUNT(*) as count FROM agents WHERE project_id IN (__IN__)', projectIds);
    usage.crews_count = getCountForProjectIds('SELECT COUNT(*) as count FROM crews WHERE project_id IN (__IN__)', projectIds);
    usage.linked_tools_count = getCountForProjectIds(
      'SELECT COUNT(DISTINCT at.tool_id) as count FROM agent_tools at JOIN agents a ON a.id = at.agent_id WHERE a.project_id IN (__IN__)',
      projectIds,
    );
    usage.linked_mcp_tools_count = getCountForProjectIds(
      'SELECT COUNT(DISTINCT amt.tool_id) as count FROM agent_mcp_tools amt JOIN agents a ON a.id = amt.agent_id WHERE a.project_id IN (__IN__)',
      projectIds,
    );
    usage.linked_mcp_bundles_count = getCountForProjectIds(
      'SELECT COUNT(DISTINCT amb.bundle_id) as count FROM agent_mcp_bundles amb JOIN agents a ON a.id = amb.agent_id WHERE a.project_id IN (__IN__)',
      projectIds,
    );
    usage.agent_executions_count = getCountForProjectIds(
      'SELECT COUNT(*) as count FROM agent_executions ae JOIN agents a ON a.id = ae.agent_id WHERE a.project_id IN (__IN__)',
      projectIds,
    );
    usage.crew_executions_count = getCountForProjectIds(
      'SELECT COUNT(*) as count FROM crew_executions ce JOIN crews c ON c.id = ce.crew_id WHERE c.project_id IN (__IN__)',
      projectIds,
    );
    usage.tool_executions_count = getCountForProjectIds(
      'SELECT COUNT(*) as count FROM tool_executions te JOIN agents a ON a.id = te.agent_id WHERE a.project_id IN (__IN__)',
      projectIds,
    );
    usage.platform_runs_count = runCountByOrg.get(orgId) || 0;
    usage.platform_events_count = eventCountByOrg.get(orgId) || 0;
  }

  return map;
}

async function assertOrgAllowedForIngestion(orgId: string) {
  const statusMap = getJsonSetting<Record<string, 'active' | 'suspended'>>(PLATFORM_ORG_STATUS_KEY, {});
  if ((statusMap[orgId] || 'active') !== 'active') {
    throw new HttpError(403, 'Organization is suspended');
  }
  const policy = await getResolvedOrgPolicy(orgId);
  if (!policy.daily_message_cap || policy.daily_message_cap <= 0) return;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayRuns = await getPrisma().run.count({
    where: { orgId, startedAt: { gte: start } },
  });
  if (todayRuns >= policy.daily_message_cap) {
    throw new HttpError(429, `Daily run cap reached (${policy.daily_message_cap})`);
  }
}

function requireBearer(req: Request): string | null {
  const h = req.header('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function getIngestProject(req: Request) {
  const bearer = requireBearer(req);
  if (bearer) {
    const apiKey = await verifyProjectApiKey(bearer);
    return { projectId: apiKey.projectId, orgId: apiKey.project.orgId, authType: 'api_key' as const };
  }

  // Fall back to session auth (internal dogfooding).
  if (!req.user) throw new HttpError(401, 'Missing Authorization header');
  const projectId = (req.body?.project_id || req.query?.project_id) as string | undefined;
  if (!projectId) throw new HttpError(400, 'project_id is required when using session auth');

  const prisma = getPrisma();
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user.orgId } });
  if (!project) throw new HttpError(404, 'Project not found');
  return { projectId: project.id, orgId: project.orgId, authType: 'session' as const };
}

function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request', details: err.flatten() });
    return;
  }
  const anyErr = err as any;
  if (anyErr?.code === 'P2002') {
    res.status(409).json({ error: 'Conflict' });
    return;
  }
  const he = asHttpError(err);
  res.status(he.status).json({ error: he.message, code: he.code });
}

const SignupBody = z.object({
  org_name: z.string().min(1).max(100),
  email: z.string().regex(EMAIL_RE, 'Invalid email'),
  password: z.string().min(8).max(200),
});

const LoginBody = z.object({
  email: z.string().regex(EMAIL_RE, 'Invalid email'),
  password: z.string().min(8).max(200),
});

const CreateProjectBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const CreateApiKeyBody = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(100),
});

const CreateRunBody = z.object({
  run_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(), // required for session auth; ignored for api key auth
  kind: z.enum(['agent_run', 'crew_run', 'tool_run', 'workflow_run']),
  name: z.string().max(200).optional(),
  status: z.string().max(50).optional().default('running'),
  environment: z.string().max(50).optional(),
  release: z.string().max(100).optional(),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/i).optional(),
  parent_run_id: z.string().uuid().optional(),
  tags: z.any().optional(),
  error: z.any().optional(),
});

const AppendEventsBody = z.object({
  events: z.array(z.object({
    event_id: z.string().uuid().optional(),
    ts: z.string().datetime().optional(),
    type: z.enum(['span_start', 'span_end', 'llm_call', 'tool_call', 'tool_result', 'log', 'metric', 'exception']),
    span_id: z.string().max(64).optional(),
    parent_span_id: z.string().max(64).optional(),
    name: z.string().max(200).optional(),
    status: z.string().max(50).optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    input_text: z.string().max(1_000_000).optional(),
    output_text: z.string().max(1_000_000).optional(),
    error: z.any().optional(),
    attributes: z.any().optional(),
  })).min(1).max(200),
});

function mergeIngestMetadataTags(existing: any, ingest: { auth_type: string; source: string }) {
  const base = existing && typeof existing === 'object' ? { ...(existing as any) } : {};
  const existingIngest = base.ingest && typeof base.ingest === 'object' ? { ...(base.ingest as any) } : {};
  base.ingest = {
    ...existingIngest,
    auth_type: existingIngest.auth_type ?? ingest.auth_type,
    source: existingIngest.source ?? ingest.source,
  };
  return base;
}

function computeUsageDelta(events: Array<z.infer<typeof AppendEventsBody>['events'][number]>) {
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;

  for (const e of events) {
    const attrs = e.attributes && typeof e.attributes === 'object' ? (e.attributes as any) : null;
    const pt = attrs?.llm?.prompt_tokens ?? attrs?.['llm.prompt_tokens'];
    const ct = attrs?.llm?.completion_tokens ?? attrs?.['llm.completion_tokens'];
    const cu = attrs?.llm?.cost_usd ?? attrs?.['llm.cost_usd'];
    if (typeof pt === 'number') promptTokens += pt;
    if (typeof ct === 'number') completionTokens += ct;
    if (typeof cu === 'number') costUsd += cu;
  }

  return { promptTokens, completionTokens, costUsd };
}

type MaxMetricsDelta = {
  promptTokensMax?: number;
  completionTokensMax?: number;
  totalTokensMax?: number;
  costUsdMax?: number;
  durationMsMax?: number;
  inputCharsMax?: number;
  outputCharsMax?: number;
};

function computeMaxMetricsDelta(events: Array<z.infer<typeof AppendEventsBody>['events'][number]>): MaxMetricsDelta {
  let promptTokensMax: number | undefined;
  let completionTokensMax: number | undefined;
  let totalTokensMax: number | undefined;
  let costUsdMax: number | undefined;
  let durationMsMax: number | undefined;
  let inputCharsMax: number | undefined;
  let outputCharsMax: number | undefined;

  for (const e of events) {
    const attrs = e.attributes && typeof e.attributes === 'object' ? (e.attributes as any) : null;
    const pt = attrs?.llm?.prompt_tokens ?? attrs?.['llm.prompt_tokens'];
    const ct = attrs?.llm?.completion_tokens ?? attrs?.['llm.completion_tokens'];
    const cu = attrs?.llm?.cost_usd ?? attrs?.['llm.cost_usd'];

    if (typeof pt === 'number') promptTokensMax = promptTokensMax == null ? pt : Math.max(promptTokensMax, pt);
    if (typeof ct === 'number') completionTokensMax = completionTokensMax == null ? ct : Math.max(completionTokensMax, ct);
    if (typeof pt === 'number' && typeof ct === 'number') {
      const tt = pt + ct;
      totalTokensMax = totalTokensMax == null ? tt : Math.max(totalTokensMax, tt);
    }
    if (typeof cu === 'number') costUsdMax = costUsdMax == null ? cu : Math.max(costUsdMax, cu);
    if (typeof e.duration_ms === 'number') durationMsMax = durationMsMax == null ? e.duration_ms : Math.max(durationMsMax, e.duration_ms);
    if (typeof e.input_text === 'string') inputCharsMax = inputCharsMax == null ? e.input_text.length : Math.max(inputCharsMax, e.input_text.length);
    if (typeof e.output_text === 'string') outputCharsMax = outputCharsMax == null ? e.output_text.length : Math.max(outputCharsMax, e.output_text.length);
  }

  return { promptTokensMax, completionTokensMax, totalTokensMax, costUsdMax, durationMsMax, inputCharsMax, outputCharsMax };
}

function mergeRunMaxMetricsTags(existingTags: any, delta: MaxMetricsDelta) {
  const base = existingTags && typeof existingTags === 'object' ? { ...(existingTags as any) } : {};
  const metrics = base.metrics && typeof base.metrics === 'object' ? { ...(base.metrics as any) } : {};
  const prevMax = metrics.max && typeof metrics.max === 'object' ? { ...(metrics.max as any) } : {};

  const nextMax = {
    prompt_tokens: typeof delta.promptTokensMax === 'number' ? Math.max(Number(prevMax.prompt_tokens || 0), delta.promptTokensMax) : Number(prevMax.prompt_tokens || 0),
    completion_tokens: typeof delta.completionTokensMax === 'number' ? Math.max(Number(prevMax.completion_tokens || 0), delta.completionTokensMax) : Number(prevMax.completion_tokens || 0),
    total_tokens: typeof delta.totalTokensMax === 'number' ? Math.max(Number(prevMax.total_tokens || 0), delta.totalTokensMax) : Number(prevMax.total_tokens || 0),
    cost_usd: typeof delta.costUsdMax === 'number' ? Math.max(Number(prevMax.cost_usd || 0), delta.costUsdMax) : Number(prevMax.cost_usd || 0),
    duration_ms: typeof delta.durationMsMax === 'number' ? Math.max(Number(prevMax.duration_ms || 0), delta.durationMsMax) : Number(prevMax.duration_ms || 0),
    input_chars: typeof delta.inputCharsMax === 'number' ? Math.max(Number(prevMax.input_chars || 0), delta.inputCharsMax) : Number(prevMax.input_chars || 0),
    output_chars: typeof delta.outputCharsMax === 'number' ? Math.max(Number(prevMax.output_chars || 0), delta.outputCharsMax) : Number(prevMax.output_chars || 0),
  };

  metrics.max = nextMax;
  metrics.updated_at = new Date().toISOString();
  base.metrics = metrics;
  return base;
}

async function resolveUserProjectId(
  prisma: ReturnType<typeof getPrisma>,
  orgId: string,
  requestedProjectId: string,
): Promise<string> {
  const raw = String(requestedProjectId || '').trim();
  if (!raw) throw new HttpError(400, 'projectId is required');

  const directProject = await prisma.project.findFirst({
    where: { id: raw, orgId },
    select: { id: true },
  });
  if (directProject) return directProject.id;

  const orchestratorId = Number(raw);
  if (Number.isFinite(orchestratorId) && orchestratorId > 0) {
    const localProject = await prisma.orchestratorProject.findUnique({
      where: { id: orchestratorId },
      select: { platformProjectId: true },
    });
    if (localProject?.platformProjectId) {
      const mappedProject = await prisma.project.findFirst({
        where: { id: localProject.platformProjectId, orgId },
        select: { id: true },
      });
      if (mappedProject) return mappedProject.id;
    }
  }

  throw new HttpError(404, 'Project not found');
}

export function registerPlatformRoutes(app: Express) {
  const router = express.Router();
  const prisma = getPrisma();

  // Auth
  router.post('/api/auth/signup', authLimiter, async (req, res, next) => {
    try {
      const body = SignupBody.parse(req.body);
      const email = body.email.toLowerCase();

      const existing = await prisma.user.findFirst({ where: { email } });
      if (existing) throw new HttpError(409, 'Email already registered');

      const passwordHash = await hashPassword(body.password);

      const result = await prisma.$transaction(async (tx) => {
        const org = await tx.org.create({ data: { name: body.org_name } });

        const roles = await tx.role.createMany({
          data: ['owner', 'admin', 'member', 'viewer'].map((name) => ({ orgId: org.id, name })),
        });
        void roles;

        const user = await tx.user.create({ data: { orgId: org.id, email, passwordHash } });

        const ownerRole = await tx.role.findFirst({ where: { orgId: org.id, name: 'owner' } });
        if (ownerRole) {
          await tx.userRole.create({ data: { userId: user.id, roleId: ownerRole.id } });
        }

        const expiresAt = new Date(Date.now() + getSessionDays() * 24 * 60 * 60 * 1000);
        const session = await tx.session.create({ data: { userId: user.id, expiresAt } });

        return { org, user, session };
      });

      setSessionCookie(res, result.session.id);
      res.json({ org: { id: result.org.id, name: result.org.name }, user: { id: result.user.id, email: result.user.email } });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/auth/login', authLimiter, async (req, res, next) => {
    try {
      const body = LoginBody.parse(req.body);
      const email = body.email.toLowerCase();

      const user = await prisma.user.findFirst({ where: { email } });
      if (!user) throw new HttpError(401, 'Invalid credentials');

      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) throw new HttpError(401, 'Invalid credentials');

      const statusMap = getJsonSetting<Record<string, 'active' | 'suspended'>>(PLATFORM_ORG_STATUS_KEY, {});
      if ((statusMap[user.orgId] || 'active') !== 'active') {
        throw new HttpError(403, 'Organization is suspended');
      }

      const policy = await getResolvedOrgPolicy(user.orgId);
      if (policy.max_active_sessions_org && policy.max_active_sessions_org > 0) {
        const orgActiveSessions = await prisma.session.count({
          where: {
            revokedAt: null,
            expiresAt: { gt: new Date() },
            user: { orgId: user.orgId },
          },
        });
        if (orgActiveSessions >= policy.max_active_sessions_org) {
          throw new HttpError(429, `Organization active session limit reached (${policy.max_active_sessions_org})`);
        }
      }
      if (policy.max_active_sessions_per_user && policy.max_active_sessions_per_user > 0) {
        const userActiveSessions = await prisma.session.count({
          where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        });
        if (userActiveSessions >= policy.max_active_sessions_per_user) {
          throw new HttpError(429, `User active session limit reached (${policy.max_active_sessions_per_user})`);
        }
      }

      const expiresAt = new Date(Date.now() + getSessionDays() * 24 * 60 * 60 * 1000);
      const session = await prisma.session.create({ data: { userId: user.id, expiresAt } });

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      setSessionCookie(res, session.id);
      res.json({ user: { id: user.id, org_id: user.orgId, email: user.email } });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/auth/logout', requireUser, async (req, res, next) => {
    try {
      const sid = req.cookies?.sid;
      if (sid) {
        await prisma.session.update({ where: { id: sid }, data: { revokedAt: new Date() } }).catch(() => undefined);
      }
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/auth/me', requireUser, async (req, res) => {
    res.json({ user: req.user });
  });

  // Platform management (session auth)
  router.get('/api/v1/projects', requireUser, async (req, res, next) => {
    try {
      const projects = await prisma.project.findMany({
        where: { orgId: req.user!.orgId },
        orderBy: { createdAt: 'desc' },
      });
      res.json(projects);
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/v1/projects', requireUser, async (req, res, next) => {
    try {
      const body = CreateProjectBody.parse(req.body);
      const project = await prisma.project.create({
        data: { orgId: req.user!.orgId, name: body.name, description: body.description },
      });
      res.json(project);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/v1/api-keys', requireUser, async (req, res, next) => {
    try {
      const projectId = req.query.project_id as string | undefined;
      if (!projectId) throw new HttpError(400, 'project_id is required');

      const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user!.orgId } });
      if (!project) throw new HttpError(404, 'Project not found');

      const keys = await prisma.projectApiKey.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      });
      res.json(keys);
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/v1/api-keys', requireUser, async (req, res, next) => {
    try {
      const body = CreateApiKeyBody.parse(req.body);
      const project = await prisma.project.findFirst({ where: { id: body.project_id, orgId: req.user!.orgId } });
      if (!project) throw new HttpError(404, 'Project not found');

      const { apiKey, rawKey } = await createProjectApiKey({ projectId: project.id, name: body.name });
      res.json({
        api_key: rawKey,
        api_key_id: apiKey.id,
        name: apiKey.name,
        created_at: apiKey.createdAt,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/v1/api-keys/:id/revoke', requireUser, async (req, res, next) => {
    try {
      const id = req.params.id;
      const key = await prisma.projectApiKey.findUnique({ where: { id }, include: { project: true } });
      if (!key) throw new HttpError(404, 'API key not found');
      if (key.project.orgId !== req.user!.orgId) throw new HttpError(403, 'Forbidden');

      await prisma.projectApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  // Ingestion (API key or session auth)
  const ingestLimiter = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/api/v1/runs', ingestLimiter, requireUserOptional, async (req, res, next) => {
    try {
      const body = CreateRunBody.parse(req.body);
      const { projectId, orgId, authType } = await getIngestProject(req);
      await assertOrgAllowedForIngestion(orgId);

      const runId = body.run_id ?? uuid();
      const traceId = (body.trace_id ?? randomTraceIdHex32()).toLowerCase();
      const ingestMeta = { auth_type: authType, source: authType === 'api_key' ? 'external' : 'session' };

      const existing = await prisma.run.findUnique({ where: { id: runId } });
      if (existing) {
        if (existing.projectId !== projectId || existing.orgId !== orgId) throw new HttpError(403, 'Run belongs to a different project');
        const updated = await prisma.run.update({
          where: { id: runId },
          data: {
            kind: body.kind,
            name: body.name ?? existing.name,
            status: body.status ?? existing.status,
            environment: body.environment ?? existing.environment,
            release: body.release ?? existing.release,
            traceId: existing.traceId || traceId,
            parentRunId: body.parent_run_id ?? existing.parentRunId,
            tags: body.tags ? mergeIngestMetadataTags(body.tags, ingestMeta) : mergeIngestMetadataTags(existing.tags, ingestMeta),
            error: body.error ?? existing.error,
          },
        });
        res.json({ run_id: updated.id, trace_id: updated.traceId });
        return;
      }

      const run = await prisma.run.create({
        data: {
          id: runId,
          orgId,
          projectId,
          kind: body.kind,
          name: body.name,
          status: body.status ?? 'running',
          environment: body.environment,
          release: body.release,
          traceId,
          parentRunId: body.parent_run_id,
          tags: mergeIngestMetadataTags(body.tags, ingestMeta),
          error: body.error,
        },
      });

      res.json({ run_id: run.id, trace_id: run.traceId });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/v1/runs/:runId/events', ingestLimiter, requireUserOptional, async (req, res, next) => {
    try {
      const runId = req.params.runId;
      const body = AppendEventsBody.parse(req.body);
      const { projectId, orgId } = await getIngestProject(req);

      const run = await prisma.run.findUnique({ where: { id: runId } });
      if (!run) throw new HttpError(404, 'Run not found');
      if (run.projectId !== projectId || run.orgId !== orgId) throw new HttpError(403, 'Forbidden');

      const events = body.events.map((e) => ({
        id: (e.event_id ?? uuid()).toLowerCase(),
        runId,
        ts: e.ts ? new Date(e.ts) : new Date(),
        type: e.type,
        spanId: e.span_id,
        parentSpanId: e.parent_span_id,
        name: e.name,
        status: e.status,
        durationMs: e.duration_ms,
        inputText: e.input_text,
        outputText: e.output_text,
        error: e.error,
        attributes: e.attributes,
      }));

      // Idempotency: only count/aggregate truly new events.
      const ids = events.map((e) => e.id);
      const existing = await prisma.runEvent.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const existingSet = new Set(existing.map((x) => x.id));

      const newEvents = events.filter((e) => !existingSet.has(e.id));
      const newBodyEvents = body.events.filter((_, i) => !existingSet.has(events[i].id));
      const delta = computeUsageDelta(newBodyEvents);
      const maxDelta = computeMaxMetricsDelta(newBodyEvents);

      if (newEvents.length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.runEvent.createMany({
            data: newEvents,
            skipDuplicates: true,
          });

          const updateData: any = {};
          if (delta.promptTokens || delta.completionTokens || delta.costUsd) {
            updateData.promptTokens = { increment: delta.promptTokens };
            updateData.completionTokens = { increment: delta.completionTokens };
            updateData.totalCostUsd = { increment: delta.costUsd };
          }

          // Store per-run max metrics in tags (AgentOps-style).
          if (
            maxDelta.promptTokensMax != null ||
            maxDelta.completionTokensMax != null ||
            maxDelta.totalTokensMax != null ||
            maxDelta.costUsdMax != null ||
            maxDelta.durationMsMax != null ||
            maxDelta.inputCharsMax != null ||
            maxDelta.outputCharsMax != null
          ) {
            const current = await tx.run.findUnique({ where: { id: runId }, select: { tags: true } });
            updateData.tags = mergeRunMaxMetricsTags(current?.tags, maxDelta);
          }

          if (Object.keys(updateData).length > 0) {
            await tx.run.update({
              where: { id: runId },
              data: updateData,
            });
          }
        });

        for (const e of newEvents) ssePublish(runId, 'event', e);
      }

      res.json({ inserted: newEvents.length });
    } catch (e) {
      next(e);
    }
  });

  // Query APIs (session auth)
  router.get('/api/v1/insights', requireUser, async (req, res, next) => {
    try {
      const projectId = req.query.project_id as string | undefined;
      if (!projectId) throw new HttpError(400, 'project_id is required');

      const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user!.orgId } });
      if (!project) throw new HttpError(404, 'Project not found');

      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;

      const where: any = {
        projectId: project.id,
        orgId: req.user!.orgId,
      };
      if (from || to) where.startedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

      const agg = await prisma.run.aggregate({
        where,
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, totalCostUsd: true, durationMs: true },
        _avg: { promptTokens: true, completionTokens: true, totalCostUsd: true, durationMs: true },
        _max: { promptTokens: true, completionTokens: true, totalCostUsd: true, durationMs: true, startedAt: true },
        _min: { startedAt: true },
      });

      const byKind = await prisma.run.groupBy({
        by: ['kind'],
        where,
        _count: { _all: true },
        _sum: { totalCostUsd: true, promptTokens: true, completionTokens: true },
      });

      const byStatus = await prisma.run.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      });

      // Tag-based breakdowns (provider/model/agent/origin). Keep it simple: fetch recent runs in range.
      const recent = await prisma.run.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: 2000,
        select: { tags: true, promptTokens: true, completionTokens: true, totalCostUsd: true, durationMs: true },
      });

      const counts: Record<string, Record<string, number>> = {
        provider: {},
        model: {},
        agent: {},
        origin: {},
        initiator: {},
      };

      const maxAcrossRuns: any = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
        duration_ms: 0,
        input_chars: 0,
        output_chars: 0,
      };

      for (const r of recent) {
        const t: any = r.tags && typeof r.tags === 'object' ? (r.tags as any) : {};
        const provider = t.provider ?? t?.llm?.provider ?? 'unknown';
        const model = t.model ?? t?.llm?.model ?? 'unknown';
        const agent = t?.agent?.name ?? 'unknown';
        const origin = t?.ingest?.source ?? 'unknown';
        const initiator = t?.orchestrator?.initiated_by ?? 'unknown';

        counts.provider[provider] = (counts.provider[provider] || 0) + 1;
        counts.model[model] = (counts.model[model] || 0) + 1;
        counts.agent[agent] = (counts.agent[agent] || 0) + 1;
        counts.origin[origin] = (counts.origin[origin] || 0) + 1;
        counts.initiator[initiator] = (counts.initiator[initiator] || 0) + 1;

        const mx = t?.metrics?.max || {};
        if (typeof mx.prompt_tokens === 'number') maxAcrossRuns.prompt_tokens = Math.max(maxAcrossRuns.prompt_tokens, mx.prompt_tokens);
        if (typeof mx.completion_tokens === 'number') maxAcrossRuns.completion_tokens = Math.max(maxAcrossRuns.completion_tokens, mx.completion_tokens);
        if (typeof mx.total_tokens === 'number') maxAcrossRuns.total_tokens = Math.max(maxAcrossRuns.total_tokens, mx.total_tokens);
        if (typeof mx.cost_usd === 'number') maxAcrossRuns.cost_usd = Math.max(maxAcrossRuns.cost_usd, mx.cost_usd);
        if (typeof mx.duration_ms === 'number') maxAcrossRuns.duration_ms = Math.max(maxAcrossRuns.duration_ms, mx.duration_ms);
        if (typeof mx.input_chars === 'number') maxAcrossRuns.input_chars = Math.max(maxAcrossRuns.input_chars, mx.input_chars);
        if (typeof mx.output_chars === 'number') maxAcrossRuns.output_chars = Math.max(maxAcrossRuns.output_chars, mx.output_chars);
      }

      const topN = (m: Record<string, number>, n = 8) =>
        Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));

      res.json({
        window: { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null },
        summary: {
          runs: agg._count._all,
          prompt_tokens: agg._sum.promptTokens || 0,
          completion_tokens: agg._sum.completionTokens || 0,
          total_tokens: (agg._sum.promptTokens || 0) + (agg._sum.completionTokens || 0),
          total_cost_usd: agg._sum.totalCostUsd?.toString?.() ?? String(agg._sum.totalCostUsd || 0),
          avg_duration_ms: agg._avg.durationMs ?? 0,
          max_duration_ms: agg._max.durationMs ?? 0,
          first_started_at: agg._min.startedAt ? agg._min.startedAt.toISOString() : null,
          last_started_at: agg._max.startedAt ? agg._max.startedAt.toISOString() : null,
        },
        breakdown: {
          kind: byKind
            .sort((a, b) => (b._count._all || 0) - (a._count._all || 0))
            .map((k) => ({
            key: k.kind,
            count: k._count._all,
            prompt_tokens: k._sum.promptTokens || 0,
            completion_tokens: k._sum.completionTokens || 0,
            total_cost_usd: k._sum.totalCostUsd?.toString?.() ?? String(k._sum.totalCostUsd || 0),
          })),
          status: byStatus
            .sort((a, b) => (b._count._all || 0) - (a._count._all || 0))
            .map((s) => ({ key: s.status, count: s._count._all })),
          provider: topN(counts.provider),
          model: topN(counts.model),
          agent: topN(counts.agent),
          origin: topN(counts.origin),
          initiator: topN(counts.initiator),
        },
        max_event_metrics: maxAcrossRuns,
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/v1/runs', requireUser, async (req, res, next) => {
    try {
      const projectId = req.query.project_id as string | undefined;
      if (!projectId) throw new HttpError(400, 'project_id is required');

      const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user!.orgId } });
      if (!project) throw new HttpError(404, 'Project not found');

      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const kind = req.query.kind ? String(req.query.kind) : undefined;
      const q = req.query.q ? String(req.query.q).trim() : undefined;

      const where: any = {
        projectId: project.id,
        orgId: req.user!.orgId,
      };
      if (from || to) where.startedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      if (status) where.status = status;
      if (kind) where.kind = kind;
      if (q) {
        const jsonContains = (path: string[]) => ({
          tags: { path, string_contains: q, mode: 'insensitive' as const },
        });
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { traceId: { contains: q, mode: 'insensitive' } },
          { id: { contains: q, mode: 'insensitive' } },
          jsonContains(['agent', 'name']),
          jsonContains(['agent', 'role']),
          jsonContains(['model']),
          jsonContains(['provider']),
          jsonContains(['llm', 'model']),
          jsonContains(['llm', 'provider']),
          jsonContains(['orchestrator', 'initiated_by']),
          jsonContains(['ingest', 'source']),
          jsonContains(['ingest', 'auth_type']),
        ];
      }

      const runs = await prisma.run.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: 200,
      });

      res.json(runs);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/v1/runs/:runId', requireUser, async (req, res, next) => {
    try {
      const runId = req.params.runId;
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 2000) : 1000;

      const run = await prisma.run.findUnique({ where: { id: runId } });
      if (!run) throw new HttpError(404, 'Run not found');
      if (run.orgId !== req.user!.orgId) throw new HttpError(403, 'Forbidden');

      const events = await prisma.runEvent.findMany({
        where: { runId },
        orderBy: { ts: 'asc' },
        take: limit,
      });

      res.json({ run, events });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/v1/runs/:runId/tags', requireUser, async (req, res, next) => {
    try {
      const runId = req.params.runId;
      const tags = req.body?.tags;
      const run = await prisma.run.findUnique({ where: { id: runId } });
      if (!run) throw new HttpError(404, 'Run not found');
      if (run.orgId !== req.user!.orgId) throw new HttpError(403, 'Forbidden');

      const updated = await prisma.run.update({ where: { id: runId }, data: { tags } });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/v1/runs/:runId/stream', requireUser, async (req, res, next) => {
    try {
      const runId = req.params.runId;
      const run = await prisma.run.findUnique({ where: { id: runId } });
      if (!run) throw new HttpError(404, 'Run not found');
      if (run.orgId !== req.user!.orgId) throw new HttpError(403, 'Forbidden');

      const snapshot = await prisma.runEvent.findMany({
        where: { runId },
        orderBy: { ts: 'asc' },
        take: 200,
      });

      sseSubscribe(runId, res);
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch (e) {
      next(e);
    }
  });

  // Platform admin APIs
  router.get('/api/admin/stats', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const [total_tenants, total_users, total_messages] = await Promise.all([
        prisma.org.count(),
        prisma.user.count(),
        prisma.runEvent.count(),
      ]);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const active_users = await prisma.user.count({
        where: {
          OR: [
            { lastLoginAt: { gte: weekAgo } },
            { sessions: { some: { revokedAt: null, expiresAt: { gt: new Date() } } } },
          ],
        },
      });
      const active_sessions = await prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
      const total_agents = Number((db.prepare('SELECT COUNT(*) as count FROM agents').get() as any)?.count || 0);
      const total_crews = Number((db.prepare('SELECT COUNT(*) as count FROM crews').get() as any)?.count || 0);
      const total_tools = Number((db.prepare('SELECT COUNT(*) as count FROM tools').get() as any)?.count || 0);
      const total_mcp_bundles = Number((db.prepare('SELECT COUNT(*) as count FROM mcp_bundles').get() as any)?.count || 0);
      res.json({
        total_tenants,
        total_users,
        total_messages,
        active_users,
        active_sessions,
        total_agents,
        total_crews,
        total_tools,
        total_mcp_bundles,
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/admin/tenants', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const orgs = await prisma.org.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true, projects: true, runs: true } } },
      });
      const usageMap = await getTenantUsageMap(orgs.map((o) => o.id), prisma);
      const planMap = new Map(getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []).map((p) => [p.id, p]));
      const assignments = getJsonSetting<Record<string, string>>(PLATFORM_PLAN_ASSIGNMENTS_KEY, {});
      const statusMap = getJsonSetting<Record<string, 'active' | 'suspended'>>(PLATFORM_ORG_STATUS_KEY, {});
      const overrides = getJsonSetting<Record<string, OrgPolicy>>(PLATFORM_ORG_OVERRIDES_KEY, {});
      const accessStore = getAccessControlsStore();
      const data = await Promise.all(orgs.map(async (o) => ({
        id: o.id,
        name: o.name,
        created_at: o.createdAt,
        users_count: o._count.users,
        projects_count: o._count.projects,
        runs_count: o._count.runs,
        status: statusMap[o.id] || 'active',
        plan_id: assignments[o.id] || null,
        plan_name: assignments[o.id] ? (planMap.get(assignments[o.id])?.name || null) : null,
        policy: await getResolvedOrgPolicy(o.id),
        policy_overrides: overrides[o.id] || {},
        usage: usageMap.get(o.id) || emptyTenantUsage(),
        access_controls: accessStore.tenants[o.id] || null,
      })));
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/admin/access-controls', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const store = getAccessControlsStore();
      const tools = db.prepare('SELECT id, name, type, category FROM tools ORDER BY name ASC').all() as any[];
      const mcpTools = db.prepare(`
        SELECT t.id as tool_id, t.name as tool_name, e.exposed_name
        FROM mcp_exposed_tools e
        JOIN tools t ON t.id = e.tool_id
        ORDER BY t.name ASC
      `).all() as any[];
      const mcpBundles = db.prepare('SELECT id, name, slug FROM mcp_bundles ORDER BY name ASC').all() as any[];
      const agents = db.prepare('SELECT id, name, project_id FROM agents ORDER BY name ASC').all() as any[];
      const links = db.prepare(`
        SELECT id as project_id, platform_project_id
        FROM projects
        WHERE platform_project_id IS NOT NULL AND platform_project_id != ''
        UNION
        SELECT project_id, platform_project_id
        FROM project_links
        WHERE project_id NOT IN (
          SELECT id FROM projects WHERE platform_project_id IS NOT NULL AND platform_project_id != ''
        )
      `).all() as any[];
      const projectMap = new Map<number, string>();
      for (const row of links) projectMap.set(Number(row.project_id), String(row.platform_project_id));
      const platformProjectIds = Array.from(new Set(Array.from(projectMap.values())));
      const platformProjects = platformProjectIds.length
        ? await prisma.project.findMany({ where: { id: { in: platformProjectIds } }, select: { id: true, orgId: true } })
        : [];
      const orgByPlatformProject = new Map(platformProjects.map((p) => [p.id, p.orgId]));

      res.json({
        global: store.global,
        tenants: store.tenants,
        resources: {
          tools,
          mcp_tools: mcpTools,
          mcp_bundles: mcpBundles,
          agents: agents.map((a) => ({
            ...a,
            org_id: a.project_id ? (orgByPlatformProject.get(projectMap.get(Number(a.project_id)) || '') || null) : null,
          })),
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/admin/learning-insights', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const agents = db.prepare('SELECT id, name FROM agents').all() as Array<{ id: number; name: string }>;
      const crews = db.prepare('SELECT id, name FROM crews').all() as Array<{ id: number; name: string }>;
      const workflows = db.prepare('SELECT id, name FROM workflows').all() as Array<{ id: number; name: string }>;
      const agentNameById = new Map(agents.map((row) => [Number(row.id), row.name]));
      const crewNameById = new Map(crews.map((row) => [Number(row.id), row.name]));
      const workflowNameById = new Map(workflows.map((row) => [Number(row.id), row.name]));

      const agentLessons = db.prepare(`
        SELECT id, agent_id, user_id, lesson_kind, task_signature, guidance, weight, source_feedback_id, updated_at
        FROM agent_learning_lessons
        ORDER BY datetime(updated_at) DESC
        LIMIT 50
      `).all() as any[];
      const agentFeedback = db.prepare(`
        SELECT id, execution_id, agent_id, user_id, rating, solved, feedback_text, task_signature, tool_sequence, created_at
        FROM run_feedback
        ORDER BY datetime(created_at) DESC
        LIMIT 50
      `).all() as any[];
      const crewFeedback = db.prepare(`
        SELECT id, execution_id, crew_id, user_id, rating, solved, feedback_text, created_at
        FROM crew_run_feedback
        ORDER BY datetime(created_at) DESC
        LIMIT 50
      `).all() as any[];
      const workflowFeedback = db.prepare(`
        SELECT id, workflow_run_id, workflow_id, user_id, rating, solved, feedback_text, created_at
        FROM workflow_run_feedback
        ORDER BY datetime(created_at) DESC
        LIMIT 50
      `).all() as any[];
      const preferences = db.prepare(`
        SELECT user_id, agent_id, preference_text, updated_at
        FROM user_agent_preferences
        ORDER BY datetime(updated_at) DESC
        LIMIT 50
      `).all() as any[];
      const learningSettings = db.prepare(`
        SELECT resource_type, resource_id, enabled, updated_at
        FROM entity_learning_settings
        ORDER BY datetime(updated_at) DESC
        LIMIT 100
      `).all() as any[];

      const disabledCounts = learningSettings.reduce(
        (acc, row) => {
          if (Number(row.enabled) === 0) {
            if (row.resource_type === 'agent') acc.agents += 1;
            if (row.resource_type === 'crew') acc.crews += 1;
            if (row.resource_type === 'workflow') acc.workflows += 1;
          }
          return acc;
        },
        { agents: 0, crews: 0, workflows: 0 },
      );

      res.json({
        summary: {
          lessons: agentLessons.length,
          feedback_rows: agentFeedback.length + crewFeedback.length + workflowFeedback.length,
          preferences: preferences.length,
          disabled_counts: disabledCounts,
        },
        settings: learningSettings,
        agent_lessons: agentLessons.map((row) => ({
          ...row,
          agent_name: agentNameById.get(Number(row.agent_id)) || `Agent ${row.agent_id}`,
        })),
        agent_feedback: agentFeedback.map((row) => ({
          ...row,
          agent_name: agentNameById.get(Number(row.agent_id)) || `Agent ${row.agent_id}`,
        })),
        crew_feedback: crewFeedback.map((row) => ({
          ...row,
          crew_name: crewNameById.get(Number(row.crew_id)) || `Crew ${row.crew_id}`,
        })),
        workflow_feedback: workflowFeedback.map((row) => ({
          ...row,
          workflow_name: workflowNameById.get(Number(row.workflow_id)) || `Workflow ${row.workflow_id}`,
        })),
        preferences: preferences.map((row) => ({
          ...row,
          agent_name: agentNameById.get(Number(row.agent_id)) || `Agent ${row.agent_id}`,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/admin/learning-insights/agent-lessons/:id', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const result = db.prepare('DELETE FROM agent_learning_lessons WHERE id = ?').run(String(req.params.id));
      if (!result.changes) throw new HttpError(404, 'Learning lesson not found');
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/admin/learning-insights/agent-feedback/:id', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const result = db.prepare('DELETE FROM run_feedback WHERE id = ?').run(String(req.params.id));
      if (!result.changes) throw new HttpError(404, 'Feedback entry not found');
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/admin/learning-insights/crew-feedback/:id', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const result = db.prepare('DELETE FROM crew_run_feedback WHERE id = ?').run(String(req.params.id));
      if (!result.changes) throw new HttpError(404, 'Crew feedback entry not found');
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/admin/learning-insights/workflow-feedback/:id', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const result = db.prepare('DELETE FROM workflow_run_feedback WHERE id = ?').run(String(req.params.id));
      if (!result.changes) throw new HttpError(404, 'Workflow feedback entry not found');
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/admin/learning-insights/entity/:resourceType/:resourceId', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const resourceType = String(req.params.resourceType);
      const resourceId = Number(req.params.resourceId);
      if (!Number.isFinite(resourceId) || resourceId <= 0) throw new HttpError(400, 'Invalid resource id');

      if (resourceType === 'agent') {
        const lessonsDeleted = db.prepare('DELETE FROM agent_learning_lessons WHERE agent_id = ?').run(resourceId).changes;
        const feedbackDeleted = db.prepare('DELETE FROM run_feedback WHERE agent_id = ?').run(resourceId).changes;
        const prefsDeleted = db.prepare('DELETE FROM user_agent_preferences WHERE agent_id = ?').run(resourceId).changes;
        const settingsDeleted = db.prepare("DELETE FROM entity_learning_settings WHERE resource_type = 'agent' AND resource_id = ?").run(resourceId).changes;
        return res.json({ success: true, deleted: { lessons: lessonsDeleted, feedback: feedbackDeleted, preferences: prefsDeleted, settings: settingsDeleted } });
      }

      if (resourceType === 'crew') {
        const feedbackDeleted = db.prepare('DELETE FROM crew_run_feedback WHERE crew_id = ?').run(resourceId).changes;
        const settingsDeleted = db.prepare("DELETE FROM entity_learning_settings WHERE resource_type = 'crew' AND resource_id = ?").run(resourceId).changes;
        return res.json({ success: true, deleted: { feedback: feedbackDeleted, settings: settingsDeleted } });
      }

      if (resourceType === 'workflow') {
        const feedbackDeleted = db.prepare('DELETE FROM workflow_run_feedback WHERE workflow_id = ?').run(resourceId).changes;
        const settingsDeleted = db.prepare("DELETE FROM entity_learning_settings WHERE resource_type = 'workflow' AND resource_id = ?").run(resourceId).changes;
        return res.json({ success: true, deleted: { feedback: feedbackDeleted, settings: settingsDeleted } });
      }

      throw new HttpError(400, 'Unsupported resource type');
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/admin/access-controls/global', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const store = getAccessControlsStore();
      store.global = normalizeAccessPolicy(req.body?.policy || {}, store.global);
      await setAccessControlsStore(store);
      res.json({ global: store.global });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/admin/tenants/:tenantId/access-controls', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const tenantId = String(req.params.tenantId);
      const org = await prisma.org.findUnique({ where: { id: tenantId } });
      if (!org) throw new HttpError(404, 'Tenant not found');
      const store = getAccessControlsStore();
      if (req.body?.reset === true) {
        delete store.tenants[tenantId];
      } else {
        store.tenants[tenantId] = normalizeAccessPolicy(req.body?.policy || {}, store.tenants[tenantId]);
      }
      await setAccessControlsStore(store);
      res.json({ tenant_id: tenantId, access_controls: store.tenants[tenantId] || null });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/admin/tenants/:tenantId', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const tenantId = String(req.params.tenantId);
      const status = req.body?.status;
      if (status !== 'active' && status !== 'suspended') throw new HttpError(400, 'Invalid status');
      const org = await prisma.org.findUnique({ where: { id: tenantId } });
      if (!org) throw new HttpError(404, 'Tenant not found');
      const statusMap = getJsonSetting<Record<string, 'active' | 'suspended'>>(PLATFORM_ORG_STATUS_KEY, {});
      statusMap[tenantId] = status;
      await setJsonSetting(PLATFORM_ORG_STATUS_KEY, statusMap);
      res.json({ success: true, tenant_id: tenantId, status });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/admin/tenants/:tenantId/policy', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const tenantId = String(req.params.tenantId);
      const org = await prisma.org.findUnique({ where: { id: tenantId } });
      if (!org) throw new HttpError(404, 'Tenant not found');

      const numericFields: Array<keyof OrgPolicy> = [
        'daily_message_cap',
        'batch_size',
        'rate_limit_per_second',
        'max_users',
        'max_numbers',
        'contact_limit',
        'credit_limit',
        'max_agents',
        'max_crews',
        'max_linked_tools',
        'max_linked_mcp_tools',
        'max_linked_mcp_bundles',
        'max_active_sessions_per_user',
        'max_active_sessions_org',
      ];

      const overrides = getJsonSetting<Record<string, OrgPolicy>>(PLATFORM_ORG_OVERRIDES_KEY, {});
      const current = { ...(overrides[tenantId] || {}) } as Record<string, any>;

      for (const field of numericFields) {
        if (!(field in (req.body || {}))) continue;
        const raw = req.body[field];
        if (raw === null || raw === '') {
          delete current[field];
          continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          throw new HttpError(400, `Invalid value for ${field}`);
        }
        current[field] = value;
      }

      if (Object.keys(current).length === 0) {
        delete overrides[tenantId];
      } else {
        overrides[tenantId] = current as OrgPolicy;
      }
      await setJsonSetting(PLATFORM_ORG_OVERRIDES_KEY, overrides);
      res.json({ tenant_id: tenantId, policy: await getResolvedOrgPolicy(tenantId), overrides: overrides[tenantId] || null });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/admin/users', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          org: { select: { id: true, name: true } },
          sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
        },
      });
      res.json(users.map((u) => ({
        id: u.id,
        email: u.email,
        org_id: u.orgId,
        org_name: u.org?.name || '',
        created_at: u.createdAt,
        last_login_at: u.lastLoginAt,
        active_sessions: u.sessions.length,
      })));
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/admin/users/:userId/reset-password', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const userId = String(req.params.userId);
      const newPassword = String(req.body?.new_password || '').trim();
      if (newPassword.length < 8) throw new HttpError(400, 'new_password must be at least 8 chars');
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new HttpError(404, 'User not found');
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/admin/settings', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const settings = getPlatformSettings();
      res.json(settings);
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/admin/settings', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const asPositive = (v: any, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : fallback;
      };
      const nextSettings = {
        daily_message_cap: asPositive(req.body?.daily_message_cap, DEFAULT_PLATFORM_SETTINGS.daily_message_cap),
        batch_size: asPositive(req.body?.batch_size, DEFAULT_PLATFORM_SETTINGS.batch_size),
        rate_limit_per_second: asPositive(req.body?.rate_limit_per_second, DEFAULT_PLATFORM_SETTINGS.rate_limit_per_second),
        max_agents: asPositive(req.body?.max_agents, DEFAULT_PLATFORM_SETTINGS.max_agents),
        max_crews: asPositive(req.body?.max_crews, DEFAULT_PLATFORM_SETTINGS.max_crews),
        max_linked_tools: asPositive(req.body?.max_linked_tools, DEFAULT_PLATFORM_SETTINGS.max_linked_tools),
        max_linked_mcp_tools: asPositive(req.body?.max_linked_mcp_tools, DEFAULT_PLATFORM_SETTINGS.max_linked_mcp_tools),
        max_linked_mcp_bundles: asPositive(req.body?.max_linked_mcp_bundles, DEFAULT_PLATFORM_SETTINGS.max_linked_mcp_bundles),
        max_active_sessions_per_user: asPositive(req.body?.max_active_sessions_per_user, DEFAULT_PLATFORM_SETTINGS.max_active_sessions_per_user),
        max_active_sessions_org: asPositive(req.body?.max_active_sessions_org, DEFAULT_PLATFORM_SETTINGS.max_active_sessions_org),
      };
      await setJsonSetting(PLATFORM_SETTINGS_KEY, nextSettings);
      res.json(nextSettings);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/admin/plans', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      res.json(getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []));
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/admin/plans', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const body = req.body || {};
      const plans = getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []);
      const asOptionalPositive = (v: any) => {
        if (v == null || v === '') return undefined;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const plan: PlatformPlan = {
        id: uuid(),
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        credit_limit: Number(body.credit_limit || 0),
        contact_limit: Number(body.contact_limit || 0),
        max_users: Number(body.max_users || 0),
        max_numbers: Number(body.max_numbers || 0),
        daily_message_cap: Number(body.daily_message_cap || DEFAULT_PLATFORM_SETTINGS.daily_message_cap),
        batch_size: Number(body.batch_size || DEFAULT_PLATFORM_SETTINGS.batch_size),
        rate_limit_per_second: Number(body.rate_limit_per_second || DEFAULT_PLATFORM_SETTINGS.rate_limit_per_second),
        max_agents: asOptionalPositive(body.max_agents),
        max_crews: asOptionalPositive(body.max_crews),
        max_linked_tools: asOptionalPositive(body.max_linked_tools),
        max_linked_mcp_tools: asOptionalPositive(body.max_linked_mcp_tools),
        max_linked_mcp_bundles: asOptionalPositive(body.max_linked_mcp_bundles),
        max_active_sessions_per_user: asOptionalPositive(body.max_active_sessions_per_user),
        max_active_sessions_org: asOptionalPositive(body.max_active_sessions_org),
        price: Number(body.price || 0),
        is_active: body.is_active !== false,
      };
      if (!plan.name) throw new HttpError(400, 'name is required');
      plans.unshift(plan);
      await setJsonSetting(PLATFORM_PLANS_KEY, plans);
      res.json(plan);
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/admin/plans/:planId', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const planId = String(req.params.planId);
      const plans = getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []);
      const idx = plans.findIndex((p) => p.id === planId);
      if (idx < 0) throw new HttpError(404, 'Plan not found');
      plans[idx] = { ...plans[idx], ...req.body };
      await setJsonSetting(PLATFORM_PLANS_KEY, plans);
      res.json(plans[idx]);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/admin/plans/:planId', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const planId = String(req.params.planId);
      const plans = getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []);
      await setJsonSetting(PLATFORM_PLANS_KEY, plans.filter((p) => p.id !== planId));
      const assignments = getJsonSetting<Record<string, string>>(PLATFORM_PLAN_ASSIGNMENTS_KEY, {});
      Object.keys(assignments).forEach((orgId) => {
        if (assignments[orgId] === planId) delete assignments[orgId];
      });
      await setJsonSetting(PLATFORM_PLAN_ASSIGNMENTS_KEY, assignments);
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/admin/tenants/:tenantId/assign-plan', requireUser, async (req, res, next) => {
    try {
      requirePlatformAdmin(req);
      const tenantId = String(req.params.tenantId);
      const planId = String(req.body?.plan_id || '').trim();
      if (!planId) throw new HttpError(400, 'plan_id is required');
      const org = await prisma.org.findUnique({ where: { id: tenantId } });
      if (!org) throw new HttpError(404, 'Tenant not found');
      const plans = getJsonSetting<PlatformPlan[]>(PLATFORM_PLANS_KEY, []);
      if (!plans.some((p) => p.id === planId)) throw new HttpError(404, 'Plan not found');
      const assignments = getJsonSetting<Record<string, string>>(PLATFORM_PLAN_ASSIGNMENTS_KEY, {});
      assignments[tenantId] = planId;
      await setJsonSetting(PLATFORM_PLAN_ASSIGNMENTS_KEY, assignments);
      const usersUpdated = await prisma.user.count({ where: { orgId: tenantId } });
      res.json({ success: true, users_updated: usersUpdated, tenant_id: tenantId, plan_id: planId });
    } catch (e) {
      next(e);
    }
  });

  // Knowledgebase routes
  router.get('/api/knowledgebase/documents', requireUser, async (req, res, next) => {
    try {
      const user = req.user!;
      const { projectId } = req.query;

      const where: any = { project: { orgId: user.orgId } };
      if (projectId) {
        const resolvedProjectId = await resolveUserProjectId(prisma, user.orgId, String(projectId));
        where.projectId = resolvedProjectId;
      }

      const documents = await prisma.document.findMany({
        where,
        include: { project: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }
      });
      res.json(documents);
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/knowledgebase/documents', requireUser, async (req, res, next) => {
    try {
      const user = req.user!;
      const { projectId } = req.body;

      const resolvedProjectId = await resolveUserProjectId(prisma, user.orgId, String(projectId || ''));

      // Handle file upload
      const multer = (await import('multer')).default();
      const upload = multer({ dest: '/tmp/' });

      upload.single('file')(req, res, async (err) => {
        if (err) return next(err);

        const file = (req as any).file;
        if (!file) throw new HttpError(400, 'No file uploaded');

        const { processDocument } = await import('../utils/documentProcessing.js');

        // Get or create default index for project
        let index = await prisma.knowledgebaseIndex.findFirst({
          where: { projectId: resolvedProjectId, name: 'Default Index' }
        });

        if (!index) {
          const { createKnowledgebaseIndex } = await import('../utils/documentProcessing.js');
          const indexId = await createKnowledgebaseIndex(
            resolvedProjectId,
            'Default Index',
            'Default knowledgebase index',
            resolveDefaultEmbeddingConfig(),
          );
          index = await prisma.knowledgebaseIndex.findUnique({ where: { id: indexId } });
        }

        if (!index) throw new HttpError(500, 'Failed to create knowledgebase index');

        // Process document
        const docId = await processDocument(
          resolvedProjectId,
          file.path,
          {
            name: req.body.name || file.originalname,
            description: req.body.description || '',
            mimeType: file.mimetype,
            fileSize: file.size
          },
          index.embeddingConfig as any
        );

        res.json({ id: docId });
      });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/api/knowledgebase/documents/:id', requireUser, async (req, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      // Verify document belongs to user's org
      const document = await prisma.document.findFirst({
        where: { id, project: { orgId: user.orgId } }
      });
      if (!document) throw new HttpError(404, 'Document not found');

      const { deleteDocument } = await import('../utils/documentProcessing.js');
      await deleteDocument(id);

      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/knowledgebase/indexes', requireUser, async (req, res, next) => {
    try {
      const user = req.user!;
      const { projectId } = req.query;

      const where: any = { project: { orgId: user.orgId } };
      if (projectId) {
        const resolvedProjectId = await resolveUserProjectId(prisma, user.orgId, String(projectId));
        where.projectId = resolvedProjectId;
      }

      const indexes = await prisma.knowledgebaseIndex.findMany({
        where,
        include: { project: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }
      });
      const projectIds = Array.from(new Set(indexes.map((index) => String(index.projectId)).filter(Boolean)));
      const statsByProject: Record<string, { documentCount: number; chunkCount: number; totalSize: number }> = {};
      if (projectIds.length > 0) {
        const docs = await prisma.document.findMany({
          where: { projectId: { in: projectIds } },
          select: {
            projectId: true,
            fileSize: true,
            _count: { select: { chunks: true } },
          },
        });
        for (const doc of docs) {
          const key = String(doc.projectId);
          const bucket = statsByProject[key] || { documentCount: 0, chunkCount: 0, totalSize: 0 };
          bucket.documentCount += 1;
          bucket.chunkCount += Number(doc._count?.chunks || 0);
          bucket.totalSize += Number(doc.fileSize || 0);
          statsByProject[key] = bucket;
        }
      }

      res.json(indexes.map((index) => ({
        ...index,
        stats: statsByProject[String(index.projectId)] || { documentCount: 0, chunkCount: 0, totalSize: 0 },
      })));
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/knowledgebase/indexes', requireUser, async (req, res, next) => {
    try {
      const user = req.user!;
      const { projectId, name, description } = req.body;

      const resolvedProjectId = await resolveUserProjectId(prisma, user.orgId, String(projectId || ''));

      const { createKnowledgebaseIndex } = await import('../utils/documentProcessing.js');
      const indexId = await createKnowledgebaseIndex(resolvedProjectId, name, description, resolveDefaultEmbeddingConfig());

      res.json({ id: indexId });
    } catch (e) {
      next(e);
    }
  });

  router.use(jsonErrorHandler);
  app.use(router);
}

async function requireUserOptional(req: Request, _res: Response, next: NextFunction) {
  // If a Bearer key exists, skip cookie auth entirely.
  if (requireBearer(req)) return next();

  // Attempt to attach req.user but don't error if missing.
  try {
    const prisma = getPrisma();
    const sid = req.cookies?.sid;
    if (!sid) return next();
    const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session) return next();
    if (session.revokedAt) return next();
    if (session.expiresAt.getTime() <= Date.now()) return next();
    req.user = { id: session.user.id, orgId: session.user.orgId, email: session.user.email };
    next();
  } catch (e) {
    next(e);
  }
}

function handleHttpErrors(app: Express) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const httpError = asHttpError(err);
    console.error('Platform API error:', err); // Added for debugging
    res.status(httpError.status).json({ error: httpError.message });
  });
}
