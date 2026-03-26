import type express from 'express';

type RegisterMcpAdminRoutesDeps = {
  app: express.Express;
  db: any;
  getPrisma: () => any;
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string | null) => Promise<void>;
  refreshPersistentMirror: () => Promise<void>;
  settingsKeyMcpAuthToken: string;
};

function getMcpBundleDependencies(db: any, bundleId: number) {
  const agents = db.prepare(`
    SELECT a.id, a.name
    FROM agent_mcp_bundles amb
    JOIN agents a ON a.id = amb.agent_id
    WHERE amb.bundle_id = ?
    ORDER BY a.name ASC
  `).all(bundleId) as any[];
  return {
    agents,
    agents_count: agents.length,
  };
}

export function registerMcpAdminRoutes({
  app,
  db,
  getPrisma,
  getSetting,
  setSetting,
  refreshPersistentMirror,
  settingsKeyMcpAuthToken,
}: RegisterMcpAdminRoutesDeps) {
  app.get('/api/mcp/config', (_req, res) => {
    const token = getSetting(settingsKeyMcpAuthToken);
    res.json({ auth_token: token || null });
  });

  app.put('/api/mcp/config', async (req, res) => {
    const { auth_token } = req.body || {};
    if (auth_token === '' || auth_token == null) {
      await setSetting(settingsKeyMcpAuthToken, null);
      return res.json({ auth_token: null });
    }
    if (typeof auth_token !== 'string') return res.status(400).json({ error: 'auth_token must be a string' });
    await setSetting(settingsKeyMcpAuthToken, auth_token.trim());
    res.json({ auth_token: auth_token.trim() });
  });

  app.get('/api/mcp/exposed-tools', async (_req, res) => {
    try {
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
        ORDER BY t.name COLLATE NOCASE ASC
      `).all();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/mcp/exposed-tools/:toolId/versions', (req, res) => {
    const toolId = Number(req.params.toolId);
    if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
    const tool = db.prepare('SELECT id, name FROM tools WHERE id = ?').get(toolId) as any;
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    const versions = db.prepare(`
      SELECT id, tool_id, version_number, exposed_name, description, is_exposed, change_kind, created_at
      FROM mcp_exposed_tool_versions
      WHERE tool_id = ?
      ORDER BY version_number DESC, id DESC
    `).all(toolId);
    res.json({ tool, versions });
  });

  app.put('/api/mcp/exposed-tools/:toolId', async (req, res) => {
    const toolId = Number(req.params.toolId);
    if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
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

      const name = typeof exposed_name === 'string' && exposed_name.trim()
        ? exposed_name.trim()
        : String(tool.name).toLowerCase().replace(/[^a-z0-9_\\-]/g, '_');
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

  app.post('/api/mcp/exposed-tools/:toolId/restore/:versionId', async (req, res) => {
    const toolId = Number(req.params.toolId);
    const versionId = Number(req.params.versionId);
    if (!Number.isFinite(toolId) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid tool or version id' });
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

  app.get('/api/mcp/bundles', async (_req, res) => {
    try {
      const prisma = getPrisma();
      const [bundles, bundleTools, tools, exposures] = await Promise.all([
        prisma.orchestratorMcpBundle.findMany({ orderBy: { updatedAt: 'desc' } }),
        prisma.orchestratorMcpBundleTool.findMany({ orderBy: [{ bundleId: 'asc' }, { toolId: 'asc' }] }),
        prisma.orchestratorTool.findMany({
          select: { id: true, name: true, description: true, category: true },
        }),
        prisma.orchestratorMcpExposedTool.findMany({
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

  app.get('/api/mcp/bundles/:id/versions', (req, res) => {
    const bundleId = Number(req.params.id);
    if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });
    const bundle = db.prepare('SELECT id, name, slug FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
    if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
    const versions = db.prepare(`
      SELECT id, bundle_id, version_number, name, slug, description, tool_ids, change_kind, created_at
      FROM mcp_bundle_versions
      WHERE bundle_id = ?
      ORDER BY version_number DESC, id DESC
    `).all(bundleId);
    const dependencies = getMcpBundleDependencies(db, bundleId);
    res.json({ bundle, versions, dependencies });
  });

  app.put('/api/mcp/bundles/:id/exposure', async (req, res) => {
    const bundleId = Number(req.params.id);
    const { is_exposed } = req.body || {};
    if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });

    try {
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

  app.post('/api/mcp/bundles', async (req, res) => {
    const { name, slug, description, tool_ids, is_exposed } = req.body || {};
    const parsedIds = Array.isArray(tool_ids) ? [...new Set(tool_ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n)))] : [];
    if (!parsedIds.length) return res.status(400).json({ error: 'tool_ids must include at least one tool' });
    const cleanName = typeof name === 'string' && name.trim() ? name.trim() : 'MCP Bundle';
    const cleanSlug = (typeof slug === 'string' && slug.trim() ? slug.trim() : cleanName.toLowerCase())
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    if (!cleanSlug) return res.status(400).json({ error: 'Invalid slug' });
    const isExposed = is_exposed !== false;

    try {
      const prisma = getPrisma();
      const existing = await prisma.orchestratorMcpBundle.findUnique({ where: { slug: cleanSlug } });
      let bundleId: number;
      let previousVersion = 0;
      if (existing) {
        bundleId = existing.id;
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

  app.post('/api/mcp/bundles/:id/restore/:versionId', async (req, res) => {
    const bundleId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    if (!Number.isFinite(bundleId) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid bundle or version id' });
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

  app.delete('/api/mcp/bundles/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid bundle id' });
    const force = String(req.query.force || '') === 'true';
    const dependencies = getMcpBundleDependencies(db, id);
    if (dependencies.agents_count > 0 && !force) {
      return res.status(409).json({ error: 'Bundle is still linked to agents.', dependencies });
    }
    try {
      const prisma = getPrisma();
      await prisma.orchestratorAgentMcpBundle.deleteMany({ where: { bundleId: id } });
      await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId: id } });
      await prisma.orchestratorMcpBundleVersion.deleteMany({ where: { bundleId: id } });
      await prisma.orchestratorMcpBundle.delete({ where: { id } });
      await refreshPersistentMirror();
      res.json({ success: true, forced: force });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to delete MCP bundle' });
    }
  });
}
