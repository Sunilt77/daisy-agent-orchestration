import type express from 'express';
import { requireUser } from '../platform/auth';
import {
  assignResourceOwner,
  deleteResourceAccess,
  getScopedAgentIds,
  getScopedBundleIds,
  getScopedToolIds,
  isPlatformAdminUser,
  requireManageableResource,
  requireVisibleBundleId,
  requireVisibleToolId,
  resolveOrchestratorAccessScope,
} from './orchestratorAccess';

type RegisterMcpAdminRoutesDeps = {
  app: express.Express;
  db: any;
  getPrisma: () => any;
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string | null) => Promise<void>;
  refreshPersistentMirror: () => Promise<void>;
  settingsKeyMcpAuthToken: string;
  getToolInputSchemaForRecord: (tool: any) => Promise<any>;
  executeTool: (toolName: string, args: any, mcpClients?: Map<string, any>, toolRecord?: any) => Promise<string>;
};

function getMcpBundleDependencies(db: any, bundleId: number, scopedAgentIds?: number[] | null) {
  const agents = db.prepare(`
    SELECT a.id, a.name
    FROM agent_mcp_bundles amb
    JOIN agents a ON a.id = amb.agent_id
    WHERE amb.bundle_id = ?
      ${scopedAgentIds ? `AND a.id IN (${scopedAgentIds.map(() => '?').join(',') || 'NULL'})` : ''}
    ORDER BY a.name ASC
  `).all(bundleId, ...(scopedAgentIds || [])) as any[];
  return {
    agents,
    agents_count: agents.length,
  };
}

function slugifyCompactMcpValue(input: string) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function compactExposedToolName(input: string, fallback = 'tool') {
  const normalized = slugifyCompactMcpValue(input)
    .replace(/^tool_+/, '')
    .replace(/^mcp_+/, '')
    .replace(/_mcp_server$/i, '')
    .replace(/_mcp$/i, '')
    .replace(/_server$/i, '');
  return normalized || slugifyCompactMcpValue(fallback) || 'tool';
}

function compactBundleSlug(input: string, fallback = 'mcp_bundle') {
  const normalized = slugifyCompactMcpValue(input)
    .replace(/^bundle_+/, '')
    .replace(/^mcp_bundle_+/, '')
    .replace(/_bundle$/i, '');
  const base = normalized || slugifyCompactMcpValue(fallback).replace(/^bundle_+/, '').replace(/^mcp_bundle_+/, '').replace(/_bundle$/i, '') || 'mcp';
  return `${base}_bundle`;
}

export function registerMcpAdminRoutes({
  app,
  db,
  getPrisma,
  getSetting,
  setSetting,
  refreshPersistentMirror,
  settingsKeyMcpAuthToken,
  getToolInputSchemaForRecord,
  executeTool,
}: RegisterMcpAdminRoutesDeps) {
  app.get('/api/mcp/local-packages', requireUser, async (req, res) => {
    try {
      const scope = await resolveOrchestratorAccessScope(req);
      const scopedToolIds = getScopedToolIds(scope);
      if (scopedToolIds && !scopedToolIds.length) return res.json([]);
      const tools = db.prepare(`
        SELECT id, name, description, config, updated_at
        FROM tools
        WHERE type = 'mcp_stdio_proxy'
          ${scopedToolIds ? `AND id IN (${scopedToolIds.map(() => '?').join(',')})` : ''}
        ORDER BY name COLLATE NOCASE ASC
      `).all(...(scopedToolIds || [])) as any[];
      const bundleLinks = db.prepare(`
        SELECT mbt.tool_id, b.id AS bundle_id, b.name AS bundle_name, b.slug AS bundle_slug, b.description AS bundle_description, b.is_exposed AS bundle_is_exposed
        FROM mcp_bundle_tools mbt
        JOIN mcp_bundles b ON b.id = mbt.bundle_id
        ORDER BY b.name COLLATE NOCASE ASC
      `).all() as any[];
      const exposedTools = db.prepare(`
        SELECT tool_id, exposed_name
        FROM mcp_exposed_tools
      `).all() as any[];
      const directAgentLinks = db.prepare(`
        SELECT amt.tool_id, a.id AS agent_id, a.name AS agent_name
        FROM agent_mcp_tools amt
        JOIN agents a ON a.id = amt.agent_id
        ORDER BY a.name COLLATE NOCASE ASC
      `).all() as any[];
      const bundleAgentLinks = db.prepare(`
        SELECT amb.bundle_id, a.id AS agent_id, a.name AS agent_name
        FROM agent_mcp_bundles amb
        JOIN agents a ON a.id = amb.agent_id
        ORDER BY a.name COLLATE NOCASE ASC
      `).all() as any[];

      const bundlesByToolId = new Map<number, any[]>();
      for (const row of bundleLinks) {
        const key = Number(row.tool_id);
        if (!bundlesByToolId.has(key)) bundlesByToolId.set(key, []);
        bundlesByToolId.get(key)!.push({
          id: Number(row.bundle_id),
          name: String(row.bundle_name || ''),
          slug: String(row.bundle_slug || ''),
          description: row.bundle_description ? String(row.bundle_description) : null,
          is_exposed: Boolean(row.bundle_is_exposed),
        });
      }

      const exposureByToolId = new Map<number, string>();
      for (const row of exposedTools) {
        exposureByToolId.set(Number(row.tool_id), String(row.exposed_name || ''));
      }

      const directAgentsByToolId = new Map<number, any[]>();
      for (const row of directAgentLinks) {
        const key = Number(row.tool_id);
        if (!directAgentsByToolId.has(key)) directAgentsByToolId.set(key, []);
        directAgentsByToolId.get(key)!.push({
          id: Number(row.agent_id),
          name: String(row.agent_name || ''),
        });
      }

      const bundleAgentsByBundleId = new Map<number, any[]>();
      for (const row of bundleAgentLinks) {
        const key = Number(row.bundle_id);
        if (!bundleAgentsByBundleId.has(key)) bundleAgentsByBundleId.set(key, []);
        bundleAgentsByBundleId.get(key)!.push({
          id: Number(row.agent_id),
          name: String(row.agent_name || ''),
        });
      }

      const runtimes = new Map<string, any>();

      for (const tool of tools) {
        let config: any = {};
        try {
          config = tool.config ? JSON.parse(tool.config) : {};
        } catch {
          config = {};
        }

        const packageName = String(config?.packageName || '').trim() || 'unknown-package';
        const rawCommand = String(config?.rawCommand || config?.command || '').trim();
        const rawArgs = Array.isArray(config?.rawArgs)
          ? config.rawArgs.map((value: any) => String(value))
          : (Array.isArray(config?.args) ? config.args.map((value: any) => String(value)) : []);
        const envObject = config?.env && typeof config.env === 'object' && !Array.isArray(config.env)
          ? Object.fromEntries(
              Object.entries(config.env)
                .map(([key, value]) => [String(key).trim(), String(value ?? '')] as const)
                .filter(([key]) => key.length > 0),
            )
          : {};
        const envSignature = JSON.stringify(
          Object.keys(envObject)
            .sort()
            .map((key) => [key, envObject[key]])
        );
        const runtimeKey = JSON.stringify({
          packageName,
          rawCommand,
          rawArgs,
          envSignature,
          timeoutMs: Number(config?.timeoutMs || 45000),
        });

        if (!runtimes.has(runtimeKey)) {
          runtimes.set(runtimeKey, {
            runtime_key: runtimeKey,
            package_name: packageName,
            runtime_label: packageName,
            transport: 'local_stdio',
            runtime_mode: 'Runs locally on this server via stdio whenever a tool is invoked.',
            raw_command: rawCommand,
            raw_args: rawArgs,
            env_keys: Object.keys(envObject).sort(),
            timeout_ms: Number(config?.timeoutMs || 45000),
            tools: [],
            bundles: [],
            agent_links: [],
            exposed_tool_count: 0,
            tool_count: 0,
            attached_agent_count: 0,
            bundle_count: 0,
            recommended_endpoint: null as null | string,
            updated_at: tool.updated_at || null,
          });
        }

        const runtime = runtimes.get(runtimeKey)!;
        const toolId = Number(tool.id);
        const bundles = bundlesByToolId.get(toolId) || [];
        const directAgents = directAgentsByToolId.get(toolId) || [];
        const bundleAgents = bundles.flatMap((bundle) => bundleAgentsByBundleId.get(Number(bundle.id)) || []);
        const allAgents = [...directAgents, ...bundleAgents];

        runtime.tools.push({
          id: toolId,
          name: String(tool.name || ''),
          description: tool.description ? String(tool.description) : '',
          mcp_tool_name: String(config?.mcpToolName || '').trim(),
          exposed_name: exposureByToolId.get(toolId) || null,
          is_exposed: exposureByToolId.has(toolId),
        });

        if (exposureByToolId.has(toolId)) runtime.exposed_tool_count += 1;

        for (const bundle of bundles) {
          if (!runtime.bundles.some((entry: any) => Number(entry.id) === Number(bundle.id))) {
            runtime.bundles.push(bundle);
          }
        }

        for (const agent of allAgents) {
          if (!runtime.agent_links.some((entry: any) => Number(entry.id) === Number(agent.id))) {
            runtime.agent_links.push(agent);
          }
        }

        if (!runtime.updated_at || String(tool.updated_at || '') > String(runtime.updated_at || '')) {
          runtime.updated_at = tool.updated_at || runtime.updated_at;
        }
      }

      const payload = Array.from(runtimes.values())
        .map((runtime: any) => {
          runtime.tools.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
          runtime.bundles.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
          runtime.agent_links.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
          runtime.tool_count = runtime.tools.length;
          runtime.bundle_count = runtime.bundles.length;
          runtime.attached_agent_count = runtime.agent_links.length;
          runtime.recommended_endpoint = runtime.bundles[0]?.slug ? `/mcp/bundle/${encodeURIComponent(String(runtime.bundles[0].slug))}` : null;
          return runtime;
        })
        .sort((a: any, b: any) => String(a.package_name).localeCompare(String(b.package_name)));

      res.json(payload);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to load local MCP packages' });
    }
  });

  app.get('/api/mcp/config', requireUser, (req, res) => {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: 'Platform admin access required' });
    const token = getSetting(settingsKeyMcpAuthToken);
    res.json({ auth_token: token || null });
  });

  app.put('/api/mcp/config', requireUser, async (req, res) => {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: 'Platform admin access required' });
    const { auth_token } = req.body || {};
    if (auth_token === '' || auth_token == null) {
      await setSetting(settingsKeyMcpAuthToken, null);
      return res.json({ auth_token: null });
    }
    if (typeof auth_token !== 'string') return res.status(400).json({ error: 'auth_token must be a string' });
    await setSetting(settingsKeyMcpAuthToken, auth_token.trim());
    res.json({ auth_token: auth_token.trim() });
  });

  app.get('/api/mcp/exposed-tools', requireUser, async (req, res) => {
    try {
      const scope = await resolveOrchestratorAccessScope(req);
      const scopedToolIds = getScopedToolIds(scope);
      if (scopedToolIds && !scopedToolIds.length) return res.json([]);
      const rows = db.prepare(`
        SELECT
          t.id AS tool_id,
          t.name AS tool_name,
          t.description AS tool_description,
          t.category AS category,
          t.type AS tool_type,
          met.exposed_name AS exposed_name,
          met.description AS exposed_description
        FROM tools t
        LEFT JOIN mcp_exposed_tools met ON met.tool_id = t.id
        ${scopedToolIds ? `WHERE t.id IN (${scopedToolIds.map(() => '?').join(',')})` : ''}
        ORDER BY t.name COLLATE NOCASE ASC
      `).all(...(scopedToolIds || []));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/mcp/exposed-tools/:toolId/versions', requireUser, async (req, res) => {
    try {
      const toolId = Number(req.params.toolId);
      if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleToolId(scope, toolId);
      const tool = db.prepare('SELECT id, name FROM tools WHERE id = ?').get(toolId) as any;
      if (!tool) return res.status(404).json({ error: 'Tool not found' });
      const versions = db.prepare(`
        SELECT id, tool_id, version_number, exposed_name, description, is_exposed, change_kind, created_at
        FROM mcp_exposed_tool_versions
        WHERE tool_id = ?
        ORDER BY version_number DESC, id DESC
      `).all(toolId);
      res.json({ tool, versions });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to load MCP tool versions' });
    }
  });

  app.put('/api/mcp/exposed-tools/:toolId', requireUser, async (req, res) => {
    const toolId = Number(req.params.toolId);
    if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
    const scope = await resolveOrchestratorAccessScope(req);
    requireVisibleToolId(scope, toolId);
    if (!scope.isAdmin) requireManageableResource(scope, 'tool', toolId);
    const { exposed, exposed_name, description } = req.body || {};
    const prisma = getPrisma();
    let tool = await prisma.orchestratorTool.findUnique({
      where: { id: toolId },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        type: true,
        config: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!tool) {
      const localTool = db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId) as any;
      if (localTool) {
        try {
          await prisma.orchestratorTool.create({
            data: {
              id: Number(localTool.id),
              name: String(localTool.name || `Tool ${toolId}`),
              description: String(localTool.description || ''),
              category: String(localTool.category || 'General'),
              type: String(localTool.type || 'custom'),
              config: localTool.config ? String(localTool.config) : '{}',
              version: Number(localTool.version || 1),
              createdAt: localTool.created_at ? new Date(localTool.created_at) : new Date(),
              updatedAt: localTool.updated_at ? new Date(localTool.updated_at) : new Date(),
            },
          });
        } catch (syncError: any) {
          console.warn(`Failed to backfill tool ${toolId} into Prisma for MCP exposure:`, syncError?.message || syncError);
        }
        tool = await prisma.orchestratorTool.findUnique({
          where: { id: toolId },
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            type: true,
            config: true,
            version: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      }
    }
    if (!tool) return res.status(404).json({ error: 'Tool not found' });

    const currentVersion = Number((db.prepare('SELECT MAX(version_number) as max_version FROM mcp_exposed_tool_versions WHERE tool_id = ?').get(toolId) as any)?.max_version || 0);

    try {
      if (!exposed) {
        await prisma.orchestratorMcpExposedTool.deleteMany({ where: { toolId } });
        await prisma.orchestratorAgentMcpTool.deleteMany({ where: { toolId } });
        await prisma.orchestratorMcpExposedToolVersion.create({
          data: {
            toolId,
            versionNumber: currentVersion + 1,
            exposedName: null,
            description: null,
            isExposed: false,
            changeKind: 'disable',
          },
        });
        try {
          db.prepare('DELETE FROM mcp_exposed_tools WHERE tool_id = ?').run(toolId);
          db.prepare(`
            INSERT INTO mcp_exposed_tool_versions (tool_id, version_number, exposed_name, description, is_exposed, change_kind)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(toolId, currentVersion + 1, null, null, 0, 'disable');
        } catch {}
        await refreshPersistentMirror();
        return res.json({ exposed: false });
      }

      const name = compactExposedToolName(
        typeof exposed_name === 'string' && exposed_name.trim() ? exposed_name.trim() : String(tool.name || ''),
        String(tool.name || 'tool'),
      );
      const desc = typeof description === 'string' && description.trim()
        ? description.trim()
        : (tool.description || '');

      await prisma.orchestratorMcpExposedTool.upsert({
        where: { toolId },
        update: {
          exposedName: name,
          description: desc,
          updatedAt: new Date(),
        },
        create: {
          toolId,
          exposedName: name,
          description: desc,
        },
      });
      await prisma.orchestratorMcpExposedToolVersion.create({
        data: {
          toolId,
          versionNumber: currentVersion + 1,
          exposedName: name,
          description: desc,
          isExposed: true,
          changeKind: currentVersion === 0 ? 'create' : 'update',
        },
      });
      try {
        db.prepare(`
          INSERT INTO mcp_exposed_tools (tool_id, exposed_name, description)
          VALUES (?, ?, ?)
          ON CONFLICT(tool_id) DO UPDATE SET exposed_name = excluded.exposed_name, description = excluded.description
        `).run(toolId, name, desc);
        db.prepare(`
          INSERT INTO mcp_exposed_tool_versions (tool_id, version_number, exposed_name, description, is_exposed, change_kind)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(toolId, currentVersion + 1, name, desc, 1, currentVersion === 0 ? 'create' : 'update');
      } catch {}
      await refreshPersistentMirror().catch(() => undefined);

      res.json({ exposed: true, exposed_name: name, description: desc });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to update exposed tool' });
    }
  });

  app.post('/api/mcp/exposed-tools/:toolId/restore/:versionId', requireUser, async (req, res) => {
    const toolId = Number(req.params.toolId);
    const versionId = Number(req.params.versionId);
    if (!Number.isFinite(toolId) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid tool or version id' });
    const scope = await resolveOrchestratorAccessScope(req);
    requireVisibleToolId(scope, toolId);
    if (!scope.isAdmin) requireManageableResource(scope, 'tool', toolId);
    const version = db.prepare(`
      SELECT *
      FROM mcp_exposed_tool_versions
      WHERE id = ? AND tool_id = ?
      LIMIT 1
    `).get(versionId, toolId) as any;
    if (!version) return res.status(404).json({ error: 'Exposure version not found' });
    const currentVersion = Number((db.prepare('SELECT MAX(version_number) as max_version FROM mcp_exposed_tool_versions WHERE tool_id = ?').get(toolId) as any)?.max_version || 0);
    try {
      const prisma = getPrisma();
      if (!version.is_exposed) {
        await prisma.orchestratorMcpExposedTool.deleteMany({ where: { toolId } });
        await prisma.orchestratorAgentMcpTool.deleteMany({ where: { toolId } });
        await prisma.orchestratorMcpExposedToolVersion.create({
          data: {
            toolId,
            versionNumber: currentVersion + 1,
            exposedName: null,
            description: null,
            isExposed: false,
            changeKind: 'restore',
          },
        });
        await refreshPersistentMirror();
        return res.json({ success: true, exposed: false, version: currentVersion + 1 });
      }
      await prisma.orchestratorMcpExposedTool.upsert({
        where: { toolId },
        update: {
          exposedName: version.exposed_name,
          description: version.description || '',
          updatedAt: new Date(),
        },
        create: {
          toolId,
          exposedName: version.exposed_name,
          description: version.description || '',
        },
      });
      await prisma.orchestratorMcpExposedToolVersion.create({
        data: {
          toolId,
          versionNumber: currentVersion + 1,
          exposedName: version.exposed_name,
          description: version.description || '',
          isExposed: true,
          changeKind: 'restore',
        },
      });
      await refreshPersistentMirror();
      res.json({ success: true, exposed: true, version: currentVersion + 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to restore exposed tool version' });
    }
  });

  app.get('/api/mcp/bundles', requireUser, async (req, res) => {
    try {
      const scope = await resolveOrchestratorAccessScope(req);
      const scopedBundleIds = getScopedBundleIds(scope);
      if (scopedBundleIds && !scopedBundleIds.length) return res.json([]);
      const prisma = getPrisma();
      const [bundles, bundleTools, tools, exposures] = await Promise.all([
        prisma.orchestratorMcpBundle.findMany({ where: scopedBundleIds ? { id: { in: scopedBundleIds } } : undefined, orderBy: { updatedAt: 'desc' } }),
        prisma.orchestratorMcpBundleTool.findMany({ where: scopedBundleIds ? { bundleId: { in: scopedBundleIds } } : undefined, orderBy: [{ bundleId: 'asc' }, { toolId: 'asc' }] }),
        prisma.orchestratorTool.findMany({
          where: getScopedToolIds(scope) ? { id: { in: getScopedToolIds(scope)! } } : undefined,
          select: { id: true, name: true, description: true, category: true },
        }),
        prisma.orchestratorMcpExposedTool.findMany({
          where: getScopedToolIds(scope) ? { toolId: { in: getScopedToolIds(scope)! } } : undefined,
          select: { toolId: true, exposedName: true },
        }),
      ]);
      const toolById = new Map<number, any>(tools.map((tool: any) => [Number(tool.id), tool] as const));
      const exposureByToolId = new Map<number, string | null>(exposures.map((row: any) => [Number(row.toolId), row.exposedName ?? null] as const));
      const toolsByBundle = new Map<number, any[]>();
      for (const row of bundleTools) {
        const tool = toolById.get(row.toolId);
        if (!tool) continue;
        if (!toolsByBundle.has(row.bundleId)) toolsByBundle.set(row.bundleId, []);
        toolsByBundle.get(row.bundleId)!.push({
          tool_id: tool.id,
          tool_name: tool.name,
          tool_description: tool.description,
          category: tool.category,
          exposed_name: exposureByToolId.get(tool.id) || null,
        });
      }
      const bundleExposureStatus = new Map();
      try {
        for (const bundle of bundles) {
          const exposureRow = db.prepare('SELECT is_exposed FROM mcp_bundles WHERE id = ?').get(bundle.id);
          bundleExposureStatus.set(bundle.id, exposureRow ? Boolean(exposureRow.is_exposed) : true);
        }
      } catch (e: any) {
        console.warn('Failed to get bundle exposure status from SQLite:', e.message);
      }

      res.json(bundles.map((b: any) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        description: b.description,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
        is_exposed: bundleExposureStatus.has(b.id) ? bundleExposureStatus.get(b.id) : Boolean(b.isExposed),
        tools: toolsByBundle.get(b.id) || [],
        tool_count: (toolsByBundle.get(b.id) || []).length,
      })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/mcp/bundles/:id/versions', requireUser, async (req, res) => {
    try {
      const bundleId = Number(req.params.id);
      if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleBundleId(scope, bundleId);
      const bundle = db.prepare('SELECT id, name, slug FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      const versions = db.prepare(`
        SELECT id, bundle_id, version_number, name, slug, description, tool_ids, change_kind, created_at
        FROM mcp_bundle_versions
        WHERE bundle_id = ?
        ORDER BY version_number DESC, id DESC
      `).all(bundleId);
      const dependencies = getMcpBundleDependencies(db, bundleId, scope.isAdmin ? null : getScopedAgentIds(scope));
      res.json({ bundle, versions, dependencies });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to load MCP bundle versions' });
    }
  });

  app.get('/api/mcp/bundles/:id/test-tools', requireUser, async (req, res) => {
    const bundleId = Number(req.params.id);
    if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });
    try {
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleBundleId(scope, bundleId);
      const bundle = db.prepare('SELECT id, name, slug, description FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

      const tools = db.prepare(`
        SELECT
          t.*,
          COALESCE(e.exposed_name, t.name) AS effective_name,
          COALESCE(e.description, t.description) AS effective_description
        FROM mcp_bundle_tools bt
        JOIN tools t ON t.id = bt.tool_id
        LEFT JOIN mcp_exposed_tools e ON e.tool_id = t.id
        WHERE bt.bundle_id = ?
        ORDER BY t.name COLLATE NOCASE ASC
      `).all(bundleId) as any[];

      const enriched = await Promise.all(tools.map(async (tool) => ({
        tool_id: tool.id,
        tool_name: tool.name,
        exposed_name: tool.effective_name,
        description: tool.effective_description || '',
        tool_type: tool.type,
        inputSchema: await getToolInputSchemaForRecord(tool),
      })));

      res.json({
        bundle: {
          id: bundle.id,
          name: bundle.name,
          slug: bundle.slug,
          description: bundle.description || '',
        },
        tools: enriched,
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Failed to load bundle test tools' });
    }
  });

  app.post('/api/mcp/bundles/:id/test-run', requireUser, async (req, res) => {
    const bundleId = Number(req.params.id);
    if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });
    try {
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleBundleId(scope, bundleId);
      const toolId = Number(req.body?.tool_id);
      if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'tool_id is required' });
      requireVisibleToolId(scope, toolId);
      const bundle = db.prepare('SELECT id, name, slug, description FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      const tool = db.prepare(`
        SELECT
          t.*,
          COALESCE(e.exposed_name, t.name) AS effective_name,
          COALESCE(e.description, t.description) AS effective_description
        FROM mcp_bundle_tools bt
        JOIN tools t ON t.id = bt.tool_id
        LEFT JOIN mcp_exposed_tools e ON e.tool_id = t.id
        WHERE bt.bundle_id = ? AND t.id = ?
        LIMIT 1
      `).get(bundleId, toolId) as any;
      if (!tool) return res.status(404).json({ error: 'Bundled tool not found' });

      const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
      const result = await executeTool(tool.name, args, undefined, tool);
      res.json({
        success: true,
        bundle: {
          id: bundle.id,
          name: bundle.name,
          slug: bundle.slug,
        },
        tool: {
          id: tool.id,
          name: tool.name,
          exposed_name: tool.effective_name,
          type: tool.type,
        },
        result,
      });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Failed to execute bundled tool test' });
    }
  });

  app.put('/api/mcp/bundles/:id/exposure', requireUser, async (req, res) => {
    const bundleId = Number(req.params.id);
    const { is_exposed } = req.body || {};
    if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });

    try {
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleBundleId(scope, bundleId);
      if (!scope.isAdmin) requireManageableResource(scope, 'mcp_bundle', bundleId);
      db.prepare('UPDATE mcp_bundles SET is_exposed = ? WHERE id = ?')
        .run(is_exposed ? 1 : 0, bundleId);

      try {
        const prisma = getPrisma();
        const bundle = await prisma.orchestratorMcpBundle.findUnique({ where: { id: bundleId } });
        if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

        await prisma.orchestratorMcpBundle.update({
          where: { id: bundleId },
          data: {
            updatedAt: new Date(),
          },
        });
      } catch (prismaError: any) {
        console.warn('Prisma update failed, continuing with SQLite only:', prismaError.message);
      }

      await refreshPersistentMirror();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/mcp/bundles', requireUser, async (req, res) => {
    const { name, slug, description, tool_ids, is_exposed } = req.body || {};
    const parsedIds = Array.isArray(tool_ids) ? [...new Set(tool_ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n)))] : [];
    if (!parsedIds.length) return res.status(400).json({ error: 'tool_ids must include at least one tool' });
    const cleanName = typeof name === 'string' && name.trim() ? name.trim() : 'MCP Bundle';
    const cleanSlug = compactBundleSlug(
      typeof slug === 'string' && slug.trim() ? slug.trim() : cleanName,
      cleanName,
    );
    if (!cleanSlug) return res.status(400).json({ error: 'Invalid slug' });
    const isExposed = is_exposed !== false;

    try {
      const scope = await resolveOrchestratorAccessScope(req);
      const prisma = getPrisma();
      for (const toolId of parsedIds) requireVisibleToolId(scope, toolId);
      const existing = await prisma.orchestratorMcpBundle.findUnique({ where: { slug: cleanSlug } });
      let bundleId: number;
      let previousVersion = 0;
      if (existing) {
        bundleId = existing.id;
        if (!scope.isAdmin) requireManageableResource(scope, 'mcp_bundle', bundleId);
        previousVersion = Number((await prisma.orchestratorMcpBundleVersion.aggregate({
          where: { bundleId },
          _max: { versionNumber: true },
        }))._max.versionNumber || 0);
        await prisma.orchestratorMcpBundle.update({
          where: { id: bundleId },
          data: {
            name: cleanName,
            description: typeof description === 'string' ? description : null,
            updatedAt: new Date(),
          },
        });

        try {
          db.prepare('UPDATE mcp_bundles SET is_exposed = ? WHERE id = ?')
            .run(isExposed ? 1 : 0, bundleId);
        } catch (e: any) {
          console.warn('Failed to update SQLite with exposure status:', e.message);
        }
      } else {
        const created = await prisma.orchestratorMcpBundle.create({
          data: {
            name: cleanName,
            slug: cleanSlug,
            description: typeof description === 'string' ? description : null,
          },
        });
        if (!scope.isAdmin && req.user) {
          assignResourceOwner('mcp_bundle', Number(created.id), req.user);
        }

        try {
          db.prepare('UPDATE mcp_bundles SET is_exposed = ? WHERE id = ?')
            .run(isExposed ? 1 : 0, created.id);
        } catch (e: any) {
          console.warn('Failed to update SQLite with exposure status:', e.message);
        }
        bundleId = created.id;
      }

      const validTools = await prisma.orchestratorTool.findMany({
        where: { id: { in: parsedIds } },
        select: { id: true },
      });
      await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId } });
      if (validTools.length) {
        await prisma.orchestratorMcpBundleTool.createMany({
          data: validTools.map((row: any) => ({ bundleId, toolId: row.id })),
          skipDuplicates: true,
        });
      }
      await prisma.orchestratorMcpBundleVersion.create({
        data: {
          bundleId,
          versionNumber: previousVersion + 1 || 1,
          name: cleanName,
          slug: cleanSlug,
          description: typeof description === 'string' ? description : null,
          toolIds: JSON.stringify(validTools.map((row: any) => row.id)),
          changeKind: previousVersion === 0 ? 'create' : 'update',
        },
      });
      await refreshPersistentMirror();
      res.json({ success: true, id: bundleId, slug: cleanSlug });
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Failed to save MCP bundle' });
    }
  });

  app.post('/api/mcp/bundles/:id/restore/:versionId', requireUser, async (req, res) => {
    const bundleId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    if (!Number.isFinite(bundleId) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid bundle or version id' });
    const scope = await resolveOrchestratorAccessScope(req);
    requireVisibleBundleId(scope, bundleId);
    if (!scope.isAdmin) requireManageableResource(scope, 'mcp_bundle', bundleId);
    const bundle = db.prepare('SELECT id FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
    if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
    const version = db.prepare(`
      SELECT *
      FROM mcp_bundle_versions
      WHERE id = ? AND bundle_id = ?
      LIMIT 1
    `).get(versionId, bundleId) as any;
    if (!version) return res.status(404).json({ error: 'Bundle version not found' });
    let toolIds: number[] = [];
    try {
      const parsed = JSON.parse(version.tool_ids || '[]');
      toolIds = Array.isArray(parsed) ? parsed.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x)) : [];
    } catch {}
    const currentVersion = Number((db.prepare('SELECT MAX(version_number) as max_version FROM mcp_bundle_versions WHERE bundle_id = ?').get(bundleId) as any)?.max_version || 0);
    try {
      const prisma = getPrisma();
      for (const toolId of toolIds) requireVisibleToolId(scope, toolId);
      const validTools = await prisma.orchestratorTool.findMany({
        where: { id: { in: toolIds } },
        select: { id: true },
      });
      await prisma.orchestratorMcpBundle.update({
        where: { id: bundleId },
        data: {
          name: version.name,
          slug: version.slug,
          description: version.description || null,
          updatedAt: new Date(),
        },
      });
      await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId } });
      if (validTools.length) {
        await prisma.orchestratorMcpBundleTool.createMany({
          data: validTools.map((row: any) => ({ bundleId, toolId: row.id })),
          skipDuplicates: true,
        });
      }
      await prisma.orchestratorMcpBundleVersion.create({
        data: {
          bundleId,
          versionNumber: currentVersion + 1,
          name: version.name,
          slug: version.slug,
          description: version.description || null,
          toolIds: JSON.stringify(validTools.map((row: any) => row.id)),
          changeKind: 'restore',
        },
      });
      await refreshPersistentMirror();
      res.json({ success: true, version: currentVersion + 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to restore bundle version' });
    }
  });

  app.delete('/api/mcp/bundles/:id', requireUser, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid bundle id' });
    const scope = await resolveOrchestratorAccessScope(req);
    requireVisibleBundleId(scope, id);
    if (!scope.isAdmin) requireManageableResource(scope, 'mcp_bundle', id);
    const force = String(req.query.force || '') === 'true';
    const dependencies = getMcpBundleDependencies(db, id, scope.isAdmin ? null : getScopedAgentIds(scope));
    if (dependencies.agents_count > 0 && !force) {
      return res.status(409).json({ error: 'Bundle is still linked to agents.', dependencies });
    }
    try {
      const prisma = getPrisma();
      await prisma.orchestratorAgentMcpBundle.deleteMany({ where: { bundleId: id } });
      await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId: id } });
      await prisma.orchestratorMcpBundleVersion.deleteMany({ where: { bundleId: id } });
      await prisma.orchestratorMcpBundle.delete({ where: { id } });
      deleteResourceAccess('mcp_bundle', id);
      await refreshPersistentMirror();
      res.json({ success: true, forced: force });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to delete MCP bundle' });
    }
  });
}
