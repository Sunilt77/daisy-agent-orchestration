import crypto from 'crypto';

export function requireAppSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('APP_SECRET must be set and at least 32 characters');
  }
  return secret;
}

export function randomTraceIdHex32(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function uuid(): string {
  return crypto.randomUUID();
}

// HMAC-based hashing so the raw API key is never stored.
export function hashApiKey(rawKey: string): string {
  const secret = requireAppSecret();
  return crypto.createHmac('sha256', secret).update(rawKey).digest('hex');
}

