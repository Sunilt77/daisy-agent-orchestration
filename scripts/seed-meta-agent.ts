import 'dotenv/config';
import { getPrisma } from '../src/platform/prisma.js';

async function seed() {
  const prisma = getPrisma();
  console.log('Seeding Meta-Architect and Internal Tools...');

  // 1. Create Internal Tools
  const internalToolsData = [
    {
      name: 'list_platform_tools',
      description: 'Lists all tools currently registered in the platform.',
      category: 'platform',
      type: 'internal',
      config: JSON.stringify({ method: 'list_platform_tools' }),
    },
    {
      name: 'upsert_platform_tool',
      description: 'Registers or updates a tool (local or MCP) in the platform.',
      category: 'platform',
      type: 'internal',
      config: JSON.stringify({ method: 'upsert_platform_tool' }),
    },
    {
      name: 'deploy_tool_script',
      description: 'Deploys a new tool script to the repository tools directory.',
      category: 'platform',
      type: 'internal',
      config: JSON.stringify({ method: 'deploy_tool_script' }),
    },
  ];

  const tools = [];
  for (const tool of internalToolsData) {
    let existing = await prisma.orchestratorTool.findFirst({ where: { name: tool.name } });
    if (existing) {
      existing = await prisma.orchestratorTool.update({
        where: { id: existing.id },
        data: tool,
      });
      tools.push(existing);
    } else {
      const created = await prisma.orchestratorTool.create({
        data: tool,
      });
      tools.push(created);
    }
    console.log(`- Seeded tool: ${tool.name}`);
  }

  // 2. Create Meta-Architect Agent
  const agentData = {
    name: 'Meta-Architect',
    role: 'System Architect & Tool Builder',
    agentRole: 'supervisor',
    goal: 'Analyze platform needs and build new specialized tools to solve tasks.',
    systemPrompt: `You are the Meta-Architect of this platform. 
Your goal is to extend the platform's capabilities by building and registering new tools.
You have access to internal platform management tools to list, create, and update tools.
When asked to build a new capability, you should:
1. Design the tool interface.
2. Implement the tool logic (usually as a script).
3. Register the tool to the platform using upsert_platform_tool.`,
    model: 'gemini-1.5-flash',
    provider: 'google',
    toolsEnabled: true,
  };

  let agent = await prisma.orchestratorAgent.findFirst({ where: { name: agentData.name } });
  if (agent) {
    agent = await prisma.orchestratorAgent.update({
      where: { id: agent.id },
      data: agentData,
    });
  } else {
    agent = await prisma.orchestratorAgent.create({
      data: agentData,
    });
  }
  console.log(`- Seeded agent: ${agent.name}`);

  // 3. Link Tools to Agent
  for (const tool of tools) {
    await prisma.orchestratorAgentTool.upsert({
      where: {
        agentId_toolId: {
          agentId: agent.id,
          toolId: tool.id,
        },
      },
      update: {},
      create: {
        agentId: agent.id,
        toolId: tool.id,
      },
    });
  }

  console.log('Seeding complete!');
}

seed()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  });
