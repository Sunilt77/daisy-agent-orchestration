import type express from 'express';
import { requireUser } from '../platform/auth';
import { isPlatformAdminUser, requireVisibleProjectId, resolveOrchestratorAccessScope } from './orchestratorAccess';

type PrismaLike = ReturnType<() => any>;

type RegisterOrchestratorConfigRoutesDeps = {
  app: express.Express;
  db: any;
  getPrisma: PrismaLike;
  refreshPersistentMirror: () => Promise<void>;
};

export function registerOrchestratorConfigRoutes({
  app,
  db,
  getPrisma,
  refreshPersistentMirror,
}: RegisterOrchestratorConfigRoutesDeps) {
  app.get('/api/projects/:id/platform-link', requireUser, async (req, res) => {
    try {
      const localProjectId = Number(req.params.id);
      if (!Number.isFinite(localProjectId)) return res.status(400).json({ error: 'Invalid project id' });
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleProjectId(scope, localProjectId);
      const row = await getPrisma().orchestratorProject.findUnique({
        where: { id: localProjectId },
        select: { platformProjectId: true },
      });
      if (row?.platformProjectId) return res.json({ platformProjectId: row.platformProjectId });
      const legacy = await getPrisma().orchestratorProjectLink.findUnique({
        where: { projectId: localProjectId },
        select: { platformProjectId: true },
      });
      res.json({ platformProjectId: legacy?.platformProjectId ?? null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/projects/:id/platform-link', requireUser, async (req, res) => {
    try {
      const prisma = getPrisma();
      const localProjectId = Number(req.params.id);
      if (!Number.isFinite(localProjectId)) return res.status(400).json({ error: 'Invalid project id' });
      const scope = await resolveOrchestratorAccessScope(req);
      requireVisibleProjectId(scope, localProjectId);

      let localProject = await prisma.orchestratorProject.findUnique({ where: { id: localProjectId }, select: { id: true } });
      if (!localProject) {
        const localProjectName = req.body?.localProjectName as unknown;
        if (typeof localProjectName === 'string' && localProjectName.trim()) {
          localProject = await prisma.orchestratorProject.findFirst({
            where: { name: localProjectName.trim() },
            orderBy: { id: 'desc' },
            select: { id: true },
          });
        }
      }
      if (!localProject) return res.status(404).json({ error: 'Project not found' });

      const platformProjectId = req.body?.platformProjectId as unknown;
      if (platformProjectId == null || platformProjectId === '') {
        await prisma.orchestratorProject.update({
          where: { id: localProject.id },
          data: { platformProjectId: null, updatedAt: new Date() },
        });
        await prisma.orchestratorProjectLink.deleteMany({ where: { projectId: localProject.id } });
        await refreshPersistentMirror();
        return res.json({ platformProjectId: null });
      }
      if (typeof platformProjectId !== 'string') return res.status(400).json({ error: 'platformProjectId must be a string' });

      const project = await getPrisma().project.findUnique({ where: { id: platformProjectId } });
      if (!project) return res.status(400).json({ error: 'Platform project not found' });
      if (!isPlatformAdminUser(req.user) && project.orgId !== req.user?.orgId) {
        return res.status(403).json({ error: 'Platform project is outside your organization.' });
      }

      await prisma.orchestratorProject.update({
        where: { id: localProject.id },
        data: {
          platformProjectId,
          updatedAt: new Date(),
        },
      });
      await prisma.orchestratorProjectLink.upsert({
        where: { projectId: localProject.id },
        update: { platformProjectId, updatedAt: new Date() },
        create: { projectId: localProject.id, platformProjectId },
      });
      await refreshPersistentMirror();

      res.json({ platformProjectId });
    } catch (e: any) {
      console.error('Failed to update project link:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/credentials', requireUser, async (req, res) => {
    try {
      if (!isPlatformAdminUser(req.user)) return res.json([]);
      const category = String(req.query.category || '').trim();
      const credentials = await getPrisma().orchestratorCredential.findMany({
        where: category ? { category } : undefined,
        orderBy: { id: 'asc' },
      });
      res.json(credentials.map((row: any) => ({
        id: row.id,
        provider: row.provider,
        name: row.name || row.provider,
        key_name: row.keyName || 'Authorization',
        category: row.category || 'general',
        api_key: '********',
      })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/credentials', requireUser, async (req, res) => {
    const { provider, name, key_name, category, api_key, key_value } = req.body || {};
    const credentialKey = String(provider || '').trim();
    const secretValue = String(api_key || key_value || '').trim();
    const categoryValue = String(category || 'general').trim() || 'general';
    if (!credentialKey) return res.status(400).json({ error: 'provider (credential key) is required' });
    if (!secretValue) return res.status(400).json({ error: 'api_key (credential value) is required' });
    try {
      if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: 'Only platform admin can manage shared credentials right now.' });
      await getPrisma().orchestratorCredential.upsert({
        where: { provider: credentialKey },
        update: {
          name: String(name || credentialKey).trim(),
          keyName: String(key_name || 'Authorization').trim(),
          category: categoryValue,
          apiKey: secretValue,
          updatedAt: new Date(),
        },
        create: {
          provider: credentialKey,
          name: String(name || credentialKey).trim(),
          keyName: String(key_name || 'Authorization').trim(),
          category: categoryValue,
          apiKey: secretValue,
        },
      });
      await refreshPersistentMirror();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/credentials/:id', requireUser, async (req, res) => {
    try {
      if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: 'Only platform admin can manage shared credentials right now.' });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid credential id' });
      await getPrisma().orchestratorCredential.deleteMany({ where: { id } });
      try {
        db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
        await refreshPersistentMirror();
      } catch (mirrorError) {
        console.error('Credential mirror refresh failed:', mirrorError);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/providers', async (_req, res) => {
    try {
      const localProviders = (db.prepare('SELECT id, name, provider, api_base, api_key, is_default FROM llm_providers ORDER BY id ASC').all() as any[])
        .map((row) => ({
          id: Number(row.id),
          name: row.name,
          provider: row.provider,
          api_base: row.api_base,
          api_key: '********',
          is_default: Boolean(row.is_default),
        }));
      if (localProviders.length) {
        return res.json(localProviders);
      }

      const providers = await getPrisma().orchestratorLlmProvider.findMany({
        orderBy: { id: 'asc' },
      });
      res.json(providers.map((row: any) => ({
        id: Number(row.id),
        name: row.name,
        provider: row.provider,
        api_base: row.apiBase,
        api_key: '********',
        is_default: Boolean(row.isDefault),
      })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/providers', async (req, res) => {
    const { name, provider, api_base, api_key, is_default } = req.body;
    const prisma = getPrisma();
    try {
      if (is_default) {
        db.prepare('UPDATE llm_providers SET is_default = 0 WHERE provider = ?').run(provider);
      }
      const localInsert = db.prepare(`
        INSERT INTO llm_providers (name, provider, api_base, api_key, is_default)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        name,
        provider,
        api_base || null,
        api_key || null,
        Boolean(is_default) ? 1 : 0
      );
      const localId = Number(localInsert.lastInsertRowid);

      if (is_default) {
        await prisma.orchestratorLlmProvider.updateMany({
          where: { provider },
          data: { isDefault: false, updatedAt: new Date() },
        });
      }
      const created = await prisma.orchestratorLlmProvider.create({
        data: {
          name,
          provider,
          apiBase: api_base || null,
          apiKey: api_key || null,
          isDefault: Boolean(is_default),
        },
      });
      res.json({ id: localId || Number(created.id) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/providers/:id', async (req, res) => {
    const { name, provider, api_base, api_key, is_default } = req.body;
    const prisma = getPrisma();
    try {
      if (is_default) {
        await prisma.orchestratorLlmProvider.updateMany({
          where: { provider, id: { not: Number(req.params.id) } },
          data: { isDefault: false, updatedAt: new Date() },
        });
      }
      const existing = await prisma.orchestratorLlmProvider.findUnique({ where: { id: Number(req.params.id) } });
      if (!existing) return res.status(404).json({ error: 'Provider not found' });
      await prisma.orchestratorLlmProvider.update({
        where: { id: Number(req.params.id) },
        data: {
          name,
          provider,
          apiBase: api_base || null,
          apiKey: api_key && api_key !== '********' ? api_key : existing.apiKey,
          isDefault: Boolean(is_default),
          updatedAt: new Date(),
        },
      });
      await refreshPersistentMirror();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/providers/:id', async (req, res) => {
    try {
      await getPrisma().orchestratorLlmProvider.delete({ where: { id: Number(req.params.id) } });
      await refreshPersistentMirror();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
