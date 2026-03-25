
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const agents = await prisma.orchestratorAgent.findMany({
      select: {
        id: true,
        name: true,
        model: true
      }
    });
    console.log('Agents in database:');
    agents.forEach(a => {
      console.log(`- ID: ${a.id}, Name: ${a.name}, Model: ${a.model}`);
    });

    const invalidAgents = agents.filter(a => a.model === 'gemini-3-flash-preview');
    console.log(`\nFound ${invalidAgents.length} agents with legacy 'gemini-3-flash-preview' model.`);
  } catch (e: any) {
    console.error('Error during data check:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
