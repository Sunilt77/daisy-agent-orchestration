import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

async function start() {
  const sqlitePath = path.resolve(process.env.SQLITE_PATH || '/tmp/orchestrator/orchestrator.db');
  process.env.SQLITE_PATH = sqlitePath;

  // Debug: list mount directory if available
  try {
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
  const prisma = new PrismaClient();
  try {
    const agentCount = await prisma.orchestratorAgent.count();
    if (agentCount === 0) {
      console.log('PostgreSQL appears empty. Checking for initial data in SQLite...');
      const Database = (await import('better-sqlite3')).default;
      
      // Try common SQLite filenames found in the mount
      const candidates = [
        sqlitePath,
        path.join(path.dirname(sqlitePath), 'database.sqlite')
      ];

      let sourceDbPath = null;
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try {
            const db = new Database(cand, { readonly: true });
            const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
            if (tableCheck) {
              const sqliteAgentCount = (db.prepare('SELECT count(*) as count FROM agents').get() as any)?.count || 0;
              if (sqliteAgentCount > 0) {
                sourceDbPath = cand;
                console.log(`Initial data found in ${path.basename(cand)} (${sqliteAgentCount} agents).`);
                db.close();
                break;
              }
            }
            db.close();
          } catch (e) {}
        }
      }

      if (sourceDbPath) {
        console.log(`Running one-time migration from ${sourceDbPath}...`);
        const { execSync } = await import('child_process');
        try {
          // Temporarily set SQLITE_PATH to the discovered source
          const env = { ...process.env, SQLITE_PATH: sourceDbPath, SQLITE_OPT_NO_JOURNAL: 'true' };
          execSync('npm run orchestrator:migrate', { stdio: 'inherit', env });
          execSync('npm run runtime:migrate', { stdio: 'inherit', env });
          console.log('Initial seeding completed successfully.');
        } catch (err) {
          console.error('Initial seeding failed during execution:', err);
        }
      } else {
        console.log('No existing agent data found in SQLite candidates.');
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
