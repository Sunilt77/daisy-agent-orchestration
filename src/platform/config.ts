import path from 'path';

function resolveSqlitePath() {
  if (process.env.SQLITE_MEMORY === 'true') return ':memory:';
  if (process.env.DATABASE_URL && !process.env.FORCE_SQLITE_FILE) return ':memory:';
  if (process.env.SQLITE_PATH) return path.resolve(process.env.SQLITE_PATH);
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return path.resolve(process.cwd(), 'orchestrator.test.db');
  }
  return path.resolve(process.cwd(), 'orchestrator.db');
}

export const SQLITE_PATH = resolveSqlitePath();
export const IS_MEMORY = SQLITE_PATH === ':memory:';
