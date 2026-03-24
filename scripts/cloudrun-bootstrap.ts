import 'dotenv/config';
import path from 'path';

async function start() {
  const sqlitePath = path.resolve(process.env.SQLITE_PATH || '/tmp/orchestrator/orchestrator.db');
  process.env.SQLITE_PATH = sqlitePath;

  // Debug: list mount directory if available
  try {
    const fs = await import('fs');
    const mountRoot = '/mnt';
    if (fs.existsSync(mountRoot)) {
      console.log(`Debug: Listing contents of mount root: ${mountRoot}`);
      const mountDirs = fs.readdirSync(mountRoot);
      console.log(`Debug: Mount dirs: ${JSON.stringify(mountDirs)}`);
      
      for (const dir of mountDirs) {
        const fullDir = path.join(mountRoot, dir);
        try {
          const stats = fs.statSync(fullDir);
          if (stats.isDirectory()) {
            const subfiles = fs.readdirSync(fullDir);
            console.log(`Debug: Files in ${fullDir}: ${JSON.stringify(subfiles)}`);
          }
        } catch (e) {}
      }
    }
  } catch (err: any) {
    console.log(`Debug: Directory listing failed:`, err.message);
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
      
      // Optimization for GCSFuse: open with journaling off to avoid .db-journal/.db-shm errors
      const db = new Database(sqlitePath, { readonly: true });
      db.pragma('journal_mode = OFF'); 
      
      const sqliteAgentCount = (db.prepare('SELECT count(*) as count FROM agents').get() as any)?.count || 0;
      db.close();

      if (sqliteAgentCount > 0) {
        console.log(`Found ${sqliteAgentCount} agents in SQLite. Running one-time migration...`);
        const { execSync } = await import('child_process');
        try {
          // Use env to tell migration scripts to also use non-journaling for safety
          execSync('npm run orchestrator:migrate', { stdio: 'inherit', env: { ...process.env, SQLITE_OPT_NO_JOURNAL: 'true' } });
          execSync('npm run runtime:migrate', { stdio: 'inherit', env: { ...process.env, SQLITE_OPT_NO_JOURNAL: 'true' } });
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
