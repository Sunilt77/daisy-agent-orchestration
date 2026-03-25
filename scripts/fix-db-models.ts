import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Updating agents with invalid model name...');
    const agents = await prisma.orchestratorAgent.findMany({
        where: {
            model: {
                in: ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-2.5-flash-latest']
            }
        }
    });

    const result = await prisma.orchestratorAgent.updateMany({
        where: {
            id: { in: agents.map(a => a.id) }
        },
        data: {
            model: 'gemini-1.5-flash'
        }
    });
    console.log(`Updated ${result.count} agents.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
