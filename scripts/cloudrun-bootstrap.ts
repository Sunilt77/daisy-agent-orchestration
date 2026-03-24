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
      console.log('PostgreSQL appears empty. Searching for initial data in SQLite across mounts...');
      const Database = (await import('better-sqlite3')).default;
      
      const searchDirs = ['/mnt', path.dirname(sqlitePath), process.cwd()];
      let sourceDbPath = null;

      for (const startDir of searchDirs) {
        if (sourceDbPath) break;
        if (!fs.existsSync(startDir)) continue;

        const files = getAllFiles(startDir);
        for (const file of files) {
          if (file.endsWith('.db') || file.endsWith('.sqlite')) {
            try {
              const db = new Database(file, { readonly: true });
              const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
              if (tableCheck) {
                const count = (db.prepare('SELECT count(*) as count FROM agents').get() as any)?.count || 0;
                if (count > 0) {
                  sourceDbPath = file;
                  console.log(`Initial data found in ${file} (${count} agents).`);
                  db.close();
                  break;
                }
              }
              db.close();
            } catch (e) {}
          }
        }
      }

      if (sourceDbPath) {
        console.log(`Running one-time migration from ${sourceDbPath}...`);
        const { execSync } = await import('child_process');
        try {
          const env = { ...process.env, SQLITE_PATH: sourceDbPath, SQLITE_OPT_NO_JOURNAL: 'true' };
          execSync('npm run orchestrator:migrate', { stdio: 'inherit', env });
          execSync('npm run runtime:migrate', { stdio: 'inherit', env });
          console.log('Initial seeding completed successfully.');
        } catch (err) {
          console.error('Initial seeding failed during execution:', err);
        }
      } else {
        console.log('No existing agent data found in any SQLite databases across scanned directories.');
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

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    try {
      if (fs.statSync(fullPath).isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        }
      } else {
        arrayOfFiles.push(fullPath);
      }
    } catch (e) {}
  });
  return arrayOfFiles;
}

start().catch((e) => {
  console.error('Cloud Run bootstrap failed:', e);
  process.exit(1);
});
