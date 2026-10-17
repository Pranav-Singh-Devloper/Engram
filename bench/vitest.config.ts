import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['dataset/**/*.test.ts', 'runner/**/*.test.ts', 'longmemeval/**/*.test.ts'],
    // Migrates the local database before integration tests (shared with core).
    globalSetup: ['../packages/core/src/testing/globalSetup.ts'],
  },
});
