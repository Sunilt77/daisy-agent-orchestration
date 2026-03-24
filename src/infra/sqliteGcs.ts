import fs from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { Storage } from '@google-cloud/storage';
import { checkpointSqlite } from '../db';
import { IS_MEMORY } from '../platform/config';

function getConfig() {
  const bucket = (process.env.GCS_SQLITE_BUCKET || '').trim();
  const prefix = (process.env.GCS_SQLITE_PREFIX || 'state').replace(/^\/+|\/+$/g, '');
  const intervalMs = Math.max(0, Number(process.env.GCS_SYNC_INTERVAL_MS || 30000));
  
  // Validate bucket: must not be empty and must not look like a path
  const isValid = bucket && !bucket.startsWith('/');
  
  return { bucket: isValid ? bucket : '', prefix, intervalMs };
}

function artifacts(sqlitePath: string, prefix: string) {
  return [
    { local: sqlitePath, remote: `${prefix}/orchestrator.db` },
    { local: `${sqlitePath}-wal`, remote: `${prefix}/orchestrator.db-wal` },
    { local: `${sqlitePath}-shm`, remote: `${prefix}/orchestrator.db-shm` },
  ];
}

export function isSqliteGcsSyncEnabled() {
  if (IS_MEMORY) return false;
  return Boolean(getConfig().bucket);
}

export async function restoreSqliteFromGcs(sqlitePath: string) {
  const { bucket, prefix } = getConfig();
  if (!bucket) return;
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const storage = new Storage();
  const b = storage.bucket(bucket);
  for (const item of artifacts(sqlitePath, prefix)) {
    const f = b.file(item.remote);
    const [exists] = await f.exists();
    if (exists) await f.download({ destination: item.local });
  }
  console.log(`SQLite restored from gs://${bucket}/${prefix} to ${sqlitePath}`);
}

export async function syncSqliteToGcs(sqlitePath: string) {
  const { bucket, prefix } = getConfig();
  if (!bucket) return;
  checkpointSqlite('TRUNCATE');
  await sleep(50);
  const storage = new Storage();
  const b = storage.bucket(bucket);
  for (const item of artifacts(sqlitePath, prefix)) {
    if (!fs.existsSync(item.local)) continue;
    await b.upload(item.local, { destination: item.remote });
  }
}

export function startSqliteGcsSyncLoop(sqlitePath: string): NodeJS.Timeout | null {
  const { intervalMs } = getConfig();
  if (!isSqliteGcsSyncEnabled() || intervalMs <= 0) return null;
  return setInterval(() => {
    syncSqliteToGcs(sqlitePath).catch((e) => console.error('SQLite GCS sync failed:', e));
  }, intervalMs);
}

