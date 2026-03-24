import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPrisma } from '../src/platform/prisma';
import { syncPersistentMirrorFromPostgres } from '../src/orchestrator/sqliteMirror';

const repoPath = process.argv[2] || '/Users/macbook/Downloads/meta_mcp_cursor';
const buildEntry = process.argv[3] || path.join(repoPath, 'build', 'index.js');

const toolFiles = [
  path.join(repoPath, 'src', 'tools', 'campaigns.ts'),
  path.join(repoPath, 'src', 'tools', 'analytics.ts'),
  path.join(repoPath, 'src', 'tools', 'audiences.ts'),
  path.join(repoPath, 'src', 'tools', 'creatives.ts'),
  path.join(repoPath, 'src', 'tools', 'oauth.ts'),
  path.join(repoPath, 'src', 'index.ts'),
];

function extractToolNames(fileContent: string): string[] {
  const names = new Set<string>();
  const re = /server\.tool\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fileContent)) !== null) {
    if (m[1]) names.add(m[1]);
  }
  return Array.from(names);
}

async function main() {
  if (!fs.existsSync(buildEntry)) {
    throw new Error(`Build entry not found: ${buildEntry}. Run "npm run build" in meta_mcp_cursor first.`);
  }

  const discovered = new Set<string>();
  for (const file of toolFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const name of extractToolNames(content)) discovered.add(name);
  }

  const names = Array.from(discovered).sort();
  if (!names.length) {
    throw new Error('No tools discovered from meta_mcp_cursor source.');
  }

  const prisma = getPrisma();

  for (const mcpToolName of names) {
    const localName = `meta_${mcpToolName}`;
    const description = `Meta MCP Cursor tool "${mcpToolName}" (stdio proxy; runs in-process on this server).`;
    const config = {
      command: 'node',
      args: [buildEntry],
      mcpToolName,
      timeoutMs: 60000,
    };
    const existing = await prisma.orchestratorTool.findFirst({
      where: { name: localName },
      select: { id: true, version: true },
    });
    if (existing?.id) {
      const nextVersion = Number(existing.version || 1) + 1;
      await prisma.orchestratorTool.update({
        where: { id: existing.id },
        data: {
          description,
          category: 'Meta MCP Cursor',
          type: 'mcp_stdio_proxy',
          config: JSON.stringify(config),
          version: nextVersion,
          updatedAt: new Date(),
        },
      });
      await prisma.orchestratorToolVersion.create({
        data: {
          toolId: existing.id,
          versionNumber: nextVersion,
          name: localName,
          description,
          category: 'Meta MCP Cursor',
          type: 'mcp_stdio_proxy',
          config: JSON.stringify(config),
          changeKind: 'update',
        },
      });
    } else {
      const created = await prisma.orchestratorTool.create({
        data: {
          name: localName,
          description,
          category: 'Meta MCP Cursor',
          type: 'mcp_stdio_proxy',
          config: JSON.stringify(config),
          version: 1,
        },
      });
      await prisma.orchestratorToolVersion.create({
        data: {
          toolId: created.id,
          versionNumber: 1,
          name: localName,
          description,
          category: 'Meta MCP Cursor',
          type: 'mcp_stdio_proxy',
          config: JSON.stringify(config),
          changeKind: 'create',
        },
      });
    }
  }

  const rows = await prisma.orchestratorTool.findMany({
    where: { category: 'Meta MCP Cursor' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const bundleName = 'Meta MCP Cursor Bundle';
  const bundleSlug = 'meta_mcp_cursor_bundle';
  const existingBundle = await prisma.orchestratorMcpBundle.findUnique({
    where: { slug: bundleSlug },
    select: { id: true },
  });

  let bundleId: number;
  let previousVersion = 0;
  if (existingBundle?.id) {
    bundleId = existingBundle.id;
    previousVersion = Number((await prisma.orchestratorMcpBundleVersion.aggregate({
      where: { bundleId },
      _max: { versionNumber: true },
    }))._max.versionNumber || 0);
    await prisma.orchestratorMcpBundle.update({
      where: { id: bundleId },
      data: {
        name: bundleName,
        description: 'Imported bundle from meta_mcp_cursor toolset',
        updatedAt: new Date(),
      },
    });
  } else {
    const created = await prisma.orchestratorMcpBundle.create({
      data: {
        name: bundleName,
        slug: bundleSlug,
        description: 'Imported bundle from meta_mcp_cursor toolset',
      },
    });
    bundleId = created.id;
  }

  await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId } });
  if (rows.length) {
    await prisma.orchestratorMcpBundleTool.createMany({
      data: rows.map((row) => ({ bundleId, toolId: row.id })),
      skipDuplicates: true,
    });
  }
  await prisma.orchestratorMcpBundleVersion.create({
    data: {
      bundleId,
      versionNumber: previousVersion + 1 || 1,
      name: bundleName,
      slug: bundleSlug,
      description: 'Imported bundle from meta_mcp_cursor toolset',
      toolIds: JSON.stringify(rows.map((row) => row.id)),
      changeKind: previousVersion === 0 ? 'create' : 'update',
    },
  });

  await syncPersistentMirrorFromPostgres();
  await prisma.$disconnect();

  console.log(`Imported ${rows.length} Meta MCP Cursor tools into Postgres-backed orchestrator tools.`);
  for (const row of rows.slice(0, 12)) {
    console.log(`- ${row.id}: ${row.name}`);
  }
  if (rows.length > 12) console.log(`... and ${rows.length - 12} more`);
  console.log(`Bundle ready: ${bundleName} (slug=${bundleSlug}) with ${rows.length} tools`);
}

main().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect().catch(() => undefined);
  process.exit(1);
});
