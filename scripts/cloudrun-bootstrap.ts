import 'dotenv/config';
import path from 'path';

async function start() {
  const sqlitePath = path.resolve(process.env.SQLITE_PATH || '/tmp/orchestrator/orchestrator.db');
  process.env.SQLITE_PATH = sqlitePath;

  // Debug: list mount directory if available
  const mountDir = path.dirname(sqlitePath);
  try {
    const fs = await import('fs');
    if (fs.existsSync(mountDir)) {
      console.log(`Debug: Listing contents of mount directory: ${mountDir}`);
      const files = fs.readdirSync(mountDir);
      console.log(`Debug: Files found: ${JSON.stringify(files)}`);
    } else {
      console.log(`Debug: Mount directory ${mountDir} does not exist.`);
    }
  } catch (err: any) {
    console.log(`Debug: Could not list mount directory ${mountDir}:`, err.message);
  }

  process.env.AUTO_START = 'false';

  const { restoreSqliteFromGcs } = await import('../src/infra/sqliteGcs.js');
  await restoreSqliteFromGcs(sqlitePath);

  // Initial Seeding: if PostgreSQL is empty but SQLite is not, run migration scripts.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const agentCount = await prisma.orchestratorAgent.count();
    if (agentCount === 0) {
      console.log('PostgreSQL appears empty. Checking for initial data in SQLite...');
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(sqlitePath);
      const sqliteAgentCount = (db.prepare('SELECT count(*) as count FROM agents').get() as any)?.count || 0;
      if (sqliteAgentCount > 0) {
        console.log(`Found ${sqliteAgentCount} agents in SQLite. Running one-time migration...`);
        // We can't easily run the tsx scripts from inside this process without exec, 
        // but we can import the migrate logic if we refactor it or just use child_process.
        const { execSync } = await import('child_process');
        try {
          execSync('npm run orchestrator:migrate', { stdio: 'inherit' });
          execSync('npm run runtime:migrate', { stdio: 'inherit' });
          console.log('Initial seeding completed successfully.');
        } catch (err) {
          console.error('Initial seeding failed during execution:', err);
        }
      }
    }
  } catch (err) {
    console.error('Error during initial seeding check:', err);
  } finally {
    await prisma.$disconnect();
  }

  const { startServer } = await import('../server.js');
  await startServer();
}

start().catch((e) => {
  console.error('Cloud Run bootstrap failed:', e);
  process.exit(1);
});
