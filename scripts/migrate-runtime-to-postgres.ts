import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import path from 'path';

const prisma = new PrismaClient();
const sqlitePath = path.resolve(process.env.SQLITE_PATH || './orchestrator.db');

async function migrate() {
  console.log(`Migrating runtime data from ${sqlitePath} to PostgreSQL...`);
  const db = new Database(sqlitePath);

  const date = (val: any) => (val ? new Date(val) : new Date());

  // 1. Crew Executions
  const execs = db.prepare('SELECT * FROM crew_executions').all() as any[];
  console.log(`Found ${execs.length} crew executions`);
  for (const e of execs) {
    await prisma.orchestratorCrewExecution.upsert({
      where: { id: Number(e.id) },
      update: {},
      create: {
        id: Number(e.id),
        crewId: Number(e.crew_id),
        status: e.status,
        logs: e.logs,
        initialInput: e.initial_input,
        retryOf: e.retry_of ? Number(e.retry_of) : null,
        createdAt: date(e.created_at),
      },
    });
  }

  // 2. Agent Sessions
  const sessions = db.prepare('SELECT * FROM agent_sessions').all() as any[];
  console.log(`Found ${sessions.length} agent sessions`);
  for (const s of sessions) {
    await prisma.orchestratorAgentSession.upsert({
      where: { id: String(s.id) },
      update: {},
      create: {
        id: String(s.id),
        agentId: Number(s.agent_id),
        userId: s.user_id,
        createdAt: date(s.created_at),
        updatedAt: date(s.updated_at),
        lastSeenAt: date(s.last_seen_at),
      },
    });
  }

  console.log('Runtime migration completed successfully!');
}

migrate()
  .catch((e) => {
    console.error('Runtime migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
