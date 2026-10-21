import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    alias: { '@/': new URL('./src/', import.meta.url).pathname },
    // Migrates the local database before integration tests (shared with core).
    globalSetup: ['../../packages/core/src/testing/globalSetup.ts'],
  },
});
