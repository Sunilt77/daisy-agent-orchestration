import type { Request } from 'express';
import db from '../db';
import { getPrisma } from '../platform/prisma';
import { HttpError } from '../platform/httpErrors';

type AuthedUser = NonNullable<Request['user']>;

export type OrchestratorAccessScope = {
  user: AuthedUser;
  isAdmin: boolean;
  allowedProjectIds: Set<number> | null;
  allowedAgentIds: Set<number> | null;
  allowedCrewIds: Set<number> | null;
  allowedToolIds: Set<number> | null;
  allowedBundleIds: Set<number> | null;
};

function getPlatformAdminEmails() {
  return String(process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminUser(user?: Request['user'] | null) {
  if (!user?.email) return false;
  const admins = getPlatformAdminEmails();
  return admins.includes(String(user.email).toLowerCase());
}

export async function resolveOrchestratorAccessScope(req: Request): Promise<OrchestratorAccessScope> {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  if (isPlatformAdminUser(req.user)) {
    return {
      user: req.user,
      isAdmin: true,
      allowedProjectIds: null,
      allowedAgentIds: null,
      allowedCrewIds: null,
      allowedToolIds: null,
      allowedBundleIds: null,
    };
  }

  const prisma = getPrisma();
  const platformProjects = await prisma.project.findMany({
    where: { orgId: req.user.orgId },
    select: { id: true },
  });
  const platformProjectIds = platformProjects.map((row) => String(row.id)).filter(Boolean);
  if (!platformProjectIds.length) {
    return {
      user: req.user,
      isAdmin: false,
      allowedProjectIds: new Set<number>(),
      allowedAgentIds: new Set<number>(),
      allowedCrewIds: new Set<number>(),
      allowedToolIds: new Set<number>(),
      allowedBundleIds: new Set<number>(),
    };
  }

  const localProjects = await prisma.orchestratorProject.findMany({
    where: { platformProjectId: { in: platformProjectIds } },
    select: { id: true },
  });
  const allowedProjectIds = new Set(localProjects.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0));
  if (!allowedProjectIds.size) {
    return {
      user: req.user,
      isAdmin: false,
      allowedProjectIds,
      allowedAgentIds: new Set<number>(),
      allowedCrewIds: new Set<number>(),
      allowedToolIds: new Set<number>(),
      allowedBundleIds: new Set<number>(),
    };
  }

  const projectIdList = Array.from(allowedProjectIds);
  const [agents, crews] = await Promise.all([
    prisma.orchestratorAgent.findMany({ where: { projectId: { in: projectIdList } }, select: { id: true } }),
    prisma.orchestratorCrew.findMany({ where: { projectId: { in: projectIdList } }, select: { id: true } }),
  ]);
  const allowedAgentIds = new Set(agents.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0));
  const allowedCrewIds = new Set(crews.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0));

  const agentIdList = Array.from(allowedAgentIds);
  const toolIds = new Set<number>();
  const bundleIds = new Set<number>();
  if (agentIdList.length) {
    const [agentTools, agentMcpTools, agentMcpBundles] = await Promise.all([
      prisma.orchestratorAgentTool.findMany({ where: { agentId: { in: agentIdList } }, select: { toolId: true } }),
      prisma.orchestratorAgentMcpTool.findMany({ where: { agentId: { in: agentIdList } }, select: { toolId: true } }),
      prisma.orchestratorAgentMcpBundle.findMany({ where: { agentId: { in: agentIdList } }, select: { bundleId: true } }),
    ]);
    for (const row of agentTools) toolIds.add(Number(row.toolId));
    for (const row of agentMcpTools) toolIds.add(Number(row.toolId));
    for (const row of agentMcpBundles) bundleIds.add(Number(row.bundleId));
    const bundleIdList = Array.from(bundleIds);
    if (bundleIdList.length) {
      const bundleTools = await prisma.orchestratorMcpBundleTool.findMany({
        where: { bundleId: { in: bundleIdList } },
        select: { toolId: true },
      });
      for (const row of bundleTools) toolIds.add(Number(row.toolId));
    }
  }

  return {
    user: req.user,
    isAdmin: false,
    allowedProjectIds,
    allowedAgentIds,
    allowedCrewIds,
    allowedToolIds: toolIds,
    allowedBundleIds: bundleIds,
  };
}

export function requireVisibleProjectId(scope: OrchestratorAccessScope, projectId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!projectId || !scope.allowedProjectIds?.has(Number(projectId))) {
    throw new HttpError(403, 'Forbidden');
  }
}

export function requireVisibleAgentId(scope: OrchestratorAccessScope, agentId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!agentId || !scope.allowedAgentIds?.has(Number(agentId))) {
    throw new HttpError(403, 'Forbidden');
  }
}

export function requireVisibleCrewId(scope: OrchestratorAccessScope, crewId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!crewId || !scope.allowedCrewIds?.has(Number(crewId))) {
    throw new HttpError(403, 'Forbidden');
  }
}

export function requireVisibleToolId(scope: OrchestratorAccessScope, toolId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!toolId || !scope.allowedToolIds?.has(Number(toolId))) {
    throw new HttpError(403, 'Forbidden');
  }
}

export function requireVisibleBundleId(scope: OrchestratorAccessScope, bundleId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!bundleId || !scope.allowedBundleIds?.has(Number(bundleId))) {
    throw new HttpError(403, 'Forbidden');
  }
}

export function getScopedProjectIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedProjectIds || []);
}

export function getScopedAgentIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedAgentIds || []);
}

export function getScopedCrewIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedCrewIds || []);
}

export function getScopedToolIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedToolIds || []);
}

export function getScopedBundleIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedBundleIds || []);
}

export function getScopedProjectLinkRows(scope: OrchestratorAccessScope) {
  const query = scope.isAdmin
    ? 'SELECT id as project_id, platform_project_id FROM projects WHERE platform_project_id IS NOT NULL AND platform_project_id != \'\''
    : `SELECT id as project_id, platform_project_id FROM projects WHERE platform_project_id IS NOT NULL AND platform_project_id != '' AND id IN (${Array.from(scope.allowedProjectIds || []).map(() => '?').join(',') || 'NULL'})`;
  return (scope.isAdmin
    ? db.prepare(query).all()
    : db.prepare(query).all(...Array.from(scope.allowedProjectIds || []))) as Array<{ project_id: number; platform_project_id: string }>;
}
