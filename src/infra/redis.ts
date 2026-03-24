import { createClient, type RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let redisConnected = false;

export async function initRedis(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  if (redisClient) return redisClient;

  redisClient = createClient({ url });
  redisClient.on('error', (err) => {
    redisConnected = false;
    console.error('Redis error:', err);
  });
  redisClient.on('ready', () => {
    redisConnected = true;
  });
  redisClient.on('end', () => {
    redisConnected = false;
  });

  await redisClient.connect();
  await redisClient.ping();
  redisConnected = true;
  console.log('Redis connected');
  return redisClient;
}

export function isRedisConnected(): boolean {
  return redisConnected;
}

export async function closeRedis(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    try {
      await redisClient.disconnect();
    } catch {
      // ignore
    }
  } finally {
    redisClient = null;
    redisConnected = false;
  }
}

