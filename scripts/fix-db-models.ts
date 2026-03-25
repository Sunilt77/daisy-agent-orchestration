import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Updating agents with invalid model name...');
    const result = await prisma.orchestratorAgent.updateMany({
        where: {
            model: 'gemini-3-flash-preview'
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
