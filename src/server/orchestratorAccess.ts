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
  allowedCredentialIds: Set<number> | null;
  allowedVoiceConfigIds: Set<number> | null;
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
      allowedCredentialIds: null,
      allowedVoiceConfigIds: null,
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
      allowedCredentialIds: new Set<number>(),
      allowedVoiceConfigIds: new Set<number>(),
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
      allowedCredentialIds: new Set<number>(),
      allowedVoiceConfigIds: new Set<number>(),
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
  const credentialIds = getAccessibleResourceIds('credential', req.user);
  const voiceConfigIds = getAccessibleResourceIds('voice_config', req.user);
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
  for (const id of getAccessibleResourceIds('tool', req.user)) toolIds.add(id);
  for (const id of getAccessibleResourceIds('mcp_bundle', req.user)) bundleIds.add(id);

  return {
    user: req.user,
    isAdmin: false,
    allowedProjectIds,
    allowedAgentIds,
    allowedCrewIds,
    allowedToolIds: toolIds,
    allowedBundleIds: bundleIds,
    allowedCredentialIds: credentialIds,
    allowedVoiceConfigIds: voiceConfigIds,
  };
}

function getAccessibleResourceIds(resourceType: string, user: AuthedUser): Set<number> {
  const rows = db.prepare(`
    SELECT resource_id
    FROM resource_owners
    WHERE resource_type = ?
      AND (
        owner_user_id = ?
        OR (visibility = 'org' AND owner_org_id = ?)
      )
    UNION
    SELECT resource_id
    FROM resource_shares
    WHERE resource_type = ?
      AND (
        shared_with_user_id = ?
        OR shared_with_org_id = ?
      )
  `).all(resourceType, user.id, user.orgId, resourceType, user.id, user.orgId) as Array<{ resource_id: number }>;
  return new Set(rows.map((row) => Number(row.resource_id)).filter((id) => Number.isFinite(id) && id > 0));
}

export function assignResourceOwner(resourceType: string, resourceId: number, user: AuthedUser, visibility: 'private' | 'org' = 'private') {
  db.prepare(`
    INSERT INTO resource_owners (
      resource_type, resource_id, owner_user_id, owner_org_id, visibility, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(resource_type, resource_id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      owner_org_id = excluded.owner_org_id,
      visibility = excluded.visibility,
      updated_at = CURRENT_TIMESTAMP
  `).run(resourceType, resourceId, user.id, user.orgId, visibility);
}

function getResourceOwnerRow(resourceType: string, resourceId: number) {
  return db.prepare(`
    SELECT resource_type, resource_id, owner_user_id, owner_org_id, visibility
    FROM resource_owners
    WHERE resource_type = ? AND resource_id = ?
    LIMIT 1
  `).get(resourceType, resourceId) as any;
}

export function requireManageableResource(scope: OrchestratorAccessScope, resourceType: string, resourceId: number) {
  if (scope.isAdmin) return;
  const owner = getResourceOwnerRow(resourceType, resourceId);
  if (!owner) throw new HttpError(403, 'Forbidden');
  if (String(owner.owner_user_id || '') !== scope.user.id) throw new HttpError(403, 'Forbidden');
}

export function getResourceAccess(resourceType: string, resourceId: number) {
  const owner = getResourceOwnerRow(resourceType, resourceId);
  const shares = db.prepare(`
    SELECT id, shared_with_user_id, shared_with_org_id, created_at
    FROM resource_shares
    WHERE resource_type = ? AND resource_id = ?
    ORDER BY id ASC
  `).all(resourceType, resourceId) as any[];
  return { owner, shares };
}

export function setResourceAccess(resourceType: string, resourceId: number, user: AuthedUser, payload: any) {
  const visibility = payload?.visibility === 'org' ? 'org' : 'private';
  assignResourceOwner(resourceType, resourceId, user, visibility);
  db.prepare('DELETE FROM resource_shares WHERE resource_type = ? AND resource_id = ?').run(resourceType, resourceId);
  const sharedUsers = Array.isArray(payload?.shared_user_ids) ? payload.shared_user_ids.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  const sharedOrgs = Array.isArray(payload?.shared_org_ids) ? payload.shared_org_ids.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  const insert = db.prepare(`
    INSERT INTO resource_shares (resource_type, resource_id, shared_with_user_id, shared_with_org_id)
    VALUES (?, ?, ?, ?)
  `);
  for (const userId of sharedUsers) insert.run(resourceType, resourceId, userId, null);
  for (const orgId of sharedOrgs) insert.run(resourceType, resourceId, null, orgId);
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

export function requireVisibleCredentialId(scope: OrchestratorAccessScope, credentialId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!credentialId || !scope.allowedCredentialIds?.has(Number(credentialId))) {
    throw new HttpError(403, 'Forbidden');
  }
}

export function requireVisibleVoiceConfigId(scope: OrchestratorAccessScope, presetId: number | null | undefined) {
  if (scope.isAdmin) return;
  if (!presetId || !scope.allowedVoiceConfigIds?.has(Number(presetId))) {
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

export function getScopedCredentialIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedCredentialIds || []);
}

export function getScopedVoiceConfigIds(scope: OrchestratorAccessScope) {
  return scope.isAdmin ? null : Array.from(scope.allowedVoiceConfigIds || []);
}

export function getScopedProjectLinkRows(scope: OrchestratorAccessScope) {
  const query = scope.isAdmin
    ? 'SELECT id as project_id, platform_project_id FROM projects WHERE platform_project_id IS NOT NULL AND platform_project_id != \'\''
    : `SELECT id as project_id, platform_project_id FROM projects WHERE platform_project_id IS NOT NULL AND platform_project_id != '' AND id IN (${Array.from(scope.allowedProjectIds || []).map(() => '?').join(',') || 'NULL'})`;
  return (scope.isAdmin
    ? db.prepare(query).all()
    : db.prepare(query).all(...Array.from(scope.allowedProjectIds || []))) as Array<{ project_id: number; platform_project_id: string }>;
}
