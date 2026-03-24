import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import path from 'path';

const prisma = new PrismaClient();
const sqlitePath = path.resolve(process.env.SQLITE_PATH || './orchestrator.db');

async function migrate() {
  console.log(`Migrating data from ${sqlitePath} to PostgreSQL...`);
  const db = new Database(sqlitePath);

  // Helper to convert SQLite timestamp to JS Date
  const date = (val: any) => (val ? new Date(val) : new Date());

  // 1. Projects
  const projects = db.prepare('SELECT * FROM projects').all() as any[];
  console.log(`Found ${projects.length} projects`);
  for (const p of projects) {
    await prisma.orchestratorProject.upsert({
      where: { id: Number(p.id) },
      update: {},
      create: {
        id: Number(p.id),
        name: p.name,
        description: p.description,
        createdAt: date(p.created_at),
      },
    });
  }

  // 2. Project Links
  const links = db.prepare('SELECT * FROM project_links').all() as any[];
  for (const l of links) {
    await prisma.orchestratorProjectLink.upsert({
      where: {
        projectId: Number(l.project_id),
      },
      update: {},
      create: {
        projectId: Number(l.project_id),
        platformProjectId: l.platform_project_id,
        createdAt: date(l.created_at),
        updatedAt: date(l.updated_at),
      },
    });
  }

  // 3. Tools
  const tools = db.prepare('SELECT * FROM tools').all() as any[];
  console.log(`Found ${tools.length} tools`);
  for (const t of tools) {
    await prisma.orchestratorTool.upsert({
      where: { id: Number(t.id) },
      update: {},
      create: {
        id: Number(t.id),
        name: t.name,
        description: t.description,
        category: t.category,
        type: t.type,
        config: t.config,
        version: t.version,
        updatedAt: date(t.updated_at),
      },
    });
  }

  // 4. Agents
  const agents = db.prepare('SELECT * FROM agents').all() as any[];
  console.log(`Found ${agents.length} agents`);
  for (const a of agents) {
    await prisma.orchestratorAgent.upsert({
      where: { id: Number(a.id) },
      update: {},
      create: {
        id: Number(a.id),
        name: a.name,
        role: a.role,
        agentRole: a.agent_role,
        status: a.status,
        goal: a.goal,
        backstory: a.backstory,
        systemPrompt: a.system_prompt,
        model: a.model,
        provider: a.provider,
        temperature: a.temperature,
        maxTokens: a.max_tokens,
        memoryWindow: a.memory_window,
        maxIterations: a.max_iterations,
        toolsEnabled: a.tools_enabled === 1,
        retryPolicy: a.retry_policy,
        timeoutMs: a.timeout_ms,
        isExposed: a.is_exposed === 1,
        projectId: a.project_id ? Number(a.project_id) : null,
      },
    });
  }

  // 5. Agent Tools
  const agentTools = db.prepare('SELECT * FROM agent_tools').all() as any[];
  for (const at of agentTools) {
    await prisma.orchestratorAgentTool.upsert({
      where: {
        agentId_toolId: {
          agentId: Number(at.agent_id),
          toolId: Number(at.tool_id),
        },
      },
      update: {},
      create: {
        agentId: Number(at.agent_id),
        toolId: Number(at.tool_id),
        createdAt: date(at.created_at),
      },
    });
  }

  // 6. Crews
  const crews = db.prepare('SELECT * FROM crews').all() as any[];
  for (const c of crews) {
    await prisma.orchestratorCrew.upsert({
      where: { id: Number(c.id) },
      update: {},
      create: {
        id: Number(c.id),
        name: c.name,
        description: c.description,
        process: c.process,
        projectId: c.project_id ? Number(c.project_id) : null,
        coordinatorAgentId: c.coordinator_agent_id ? Number(c.coordinator_agent_id) : null,
        createdAt: date(c.created_at),
        updatedAt: date(c.updated_at),
      },
    });
  }

  // 7. Crew Agents
  const crewAgents = db.prepare('SELECT * FROM crew_agents').all() as any[];
  for (const ca of crewAgents) {
    await prisma.orchestratorCrewAgent.upsert({
      where: {
        crewId_agentId: {
          crewId: Number(ca.crew_id),
          agentId: Number(ca.agent_id),
        },
      },
      update: {},
      create: {
        crewId: Number(ca.crew_id),
        agentId: Number(ca.agent_id),
        createdAt: date(ca.created_at),
      },
    });
  }

  // 8. MCP Bundles
  const bundles = db.prepare('SELECT * FROM mcp_bundles').all() as any[];
  for (const b of bundles) {
    await prisma.orchestratorMcpBundle.upsert({
      where: { id: Number(b.id) },
      update: {},
      create: {
        id: Number(b.id),
        name: b.name,
        slug: b.slug,
        description: b.description,
        createdAt: date(b.created_at),
        updatedAt: date(b.updated_at),
      },
    });
  }
  
  // 9. MCP Exposed Tools
  const exposed = db.prepare('SELECT * FROM mcp_exposed_tools').all() as any[];
  for (const e of exposed) {
    await prisma.orchestratorMcpExposedTool.upsert({
      where: { toolId: Number(e.tool_id) },
      update: {},
      create: {
        toolId: Number(e.tool_id),
        exposedName: e.exposed_name,
        description: e.description,
        createdAt: date(e.created_at),
        updatedAt: date(e.updated_at),
      },
    });
  }

  console.log('Migration completed successfully!');
}

migrate()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
