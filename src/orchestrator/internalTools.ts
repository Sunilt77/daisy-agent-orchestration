import { getPrisma } from '../platform/prisma.js';
import { refreshPersistentMirror } from './sqliteMirror.js';
import fs from 'fs';
import path from 'path';

/**
 * Lists all registered tools in the platform.
 */
export async function listPlatformTools() {
  const prisma = getPrisma();
  return prisma.orchestratorTool.findMany({
    orderBy: { name: 'asc' },
  });
}

/**
 * Registers or updates a tool in the platform.
 */
export async function upsertPlatformTool(params: {
  name: string;
  description: string;
  category?: string;
  type?: string;
  config?: any;
}) {
  const prisma = getPrisma();
  let { name, description, category, type, config } = params;
  
  // If config is just a code string, wrap it properly for python/custom tools
  if (typeof config === 'string' && (type === 'python' || !type)) {
     config = { code: config };
  }
  
  const serializedConfig = config ? (typeof config === 'string' ? config : JSON.stringify(config)) : '{}';
  
  const existing = await prisma.orchestratorTool.findFirst({ where: { name } });
  
  if (existing) {
    const updated = await prisma.orchestratorTool.update({
      where: { id: existing.id },
      data: {
        description: description || existing.description,
        category: category || existing.category,
        type: type || existing.type,
        config: serializedConfig,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    
    // Create new version entry
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: updated.id,
        versionNumber: updated.version,
        name,
        description,
        category: updated.category,
        type: updated.type,
        config: serializedConfig,
        changeKind: 'update',
      },
    });
    
    await refreshPersistentMirror();
    return { id: updated.id, status: 'updated' };
  } else {
    const created = await prisma.orchestratorTool.create({
      data: {
        name,
        description,
        category: category || 'general',
        type: type || 'custom',
        config: serializedConfig,
        version: 1,
      },
    });
    
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: created.id,
        versionNumber: 1,
        name,
        description,
        category: created.category,
        type: created.type,
        config: serializedConfig,
        changeKind: 'create',
      },
    });
    
    await refreshPersistentMirror();
    return { id: created.id, status: 'created' };
  }
}

/**
 * Deploys a tool script to the repository's tools directory.
 */
export async function deployToolScript(params: {
  filename: string;
  content: string;
}) {
  const { filename, content } = params;
  const toolsDir = path.resolve(process.cwd(), 'tools');
  
  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }
  
  const filePath = path.join(toolsDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  
  return { path: filePath, status: 'deployed' };
}
