import 'dotenv/config';
import { getPrisma } from '../src/platform/prisma';
import { syncPersistentMirrorFromPostgres } from '../src/orchestrator/sqliteMirror';

function parseArg(flag: string, fallback: string): string {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const serverUrl = parseArg('--server-url', process.env.META_MCP_SERVER_URL || 'http://localhost:3001/mcp');
  const toolName = parseArg('--name', process.env.META_MCP_TOOL_NAME || 'meta_ads_mcp_cursor');
  const toolDescription = parseArg(
    '--description',
    'Meta Marketing MCP (meta_mcp_cursor) via Streamable HTTP for campaigns, audiences, creatives, and insights.',
  );
  const exposedName = parseArg('--exposed-name', process.env.META_MCP_EXPOSED_NAME || 'tool_meta_ads_mcp_cursor');
  const expose = process.argv.includes('--expose');

  const prisma = getPrisma();
  const config = {
    serverUrl,
    transportType: 'streamable',
    apiKey: process.env.META_MCP_API_KEY || '',
    customHeaders: {},
  };

  const existing = await prisma.orchestratorTool.findFirst({
    where: { name: toolName },
    select: { id: true, version: true },
  });

  let toolId: number;
  let nextVersion = 1;
  if (existing?.id) {
    nextVersion = Number(existing.version || 1) + 1;
    await prisma.orchestratorTool.update({
      where: { id: existing.id },
      data: {
        description: toolDescription,
        category: 'MCP',
        type: 'mcp',
        config: JSON.stringify(config),
        version: nextVersion,
        updatedAt: new Date(),
      },
    });
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: existing.id,
        versionNumber: nextVersion,
        name: toolName,
        description: toolDescription,
        category: 'MCP',
        type: 'mcp',
        config: JSON.stringify(config),
        changeKind: 'update',
      },
    });
    toolId = existing.id;
    console.log(`Updated MCP tool "${toolName}" (id=${toolId})`);
  } else {
    const created = await prisma.orchestratorTool.create({
      data: {
        name: toolName,
        description: toolDescription,
        category: 'MCP',
        type: 'mcp',
        config: JSON.stringify(config),
        version: 1,
      },
    });
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: created.id,
        versionNumber: 1,
        name: toolName,
        description: toolDescription,
        category: 'MCP',
        type: 'mcp',
        config: JSON.stringify(config),
        changeKind: 'create',
      },
    });
    toolId = created.id;
    console.log(`Created MCP tool "${toolName}" (id=${toolId})`);
  }

  if (expose) {
    const currentVersion = Number((await prisma.orchestratorMcpExposedToolVersion.aggregate({
      where: { toolId },
      _max: { versionNumber: true },
    }))._max.versionNumber || 0);

    await prisma.orchestratorMcpExposedTool.upsert({
      where: { toolId },
      update: {
        exposedName,
        description: toolDescription,
        updatedAt: new Date(),
      },
      create: {
        toolId,
        exposedName,
        description: toolDescription,
      },
    });
    await prisma.orchestratorMcpExposedToolVersion.create({
      data: {
        toolId,
        versionNumber: currentVersion + 1,
        exposedName,
        description: toolDescription,
        isExposed: true,
        changeKind: currentVersion === 0 ? 'create' : 'update',
      },
    });
    console.log(`Exposed MCP tool as "${exposedName}"`);
  }

  await syncPersistentMirrorFromPostgres();
  await prisma.$disconnect();

  console.log('\nNext:');
  console.log('1) Start meta_mcp_cursor HTTP server:');
  console.log('   cd /Users/macbook/Downloads/meta_mcp_cursor && npm install && npm run dev:http');
  console.log(`2) Verify endpoint: ${serverUrl}`);
  console.log(`3) In this app, open Tools and test "${toolName}" connection.`);
}

main().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect().catch(() => undefined);
  process.exit(1);
});
