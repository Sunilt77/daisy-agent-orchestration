process.env.VITEST = 'true';
process.env.NODE_ENV = 'test';

// Ensure the app has a secret for hashing API keys and sessions.
if (!process.env.APP_SECRET) {
  process.env.APP_SECRET = 'test-only-secret-test-only-secret-test-only-secret';
}

