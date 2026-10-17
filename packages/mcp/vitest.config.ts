import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Migrates the local database before integration tests (shared with core).
    globalSetup: ['../core/src/testing/globalSetup.ts'],
  },
});
