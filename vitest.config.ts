import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
