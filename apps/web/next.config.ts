import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source (no build step).
  transpilePackages: ['@engram/core', '@engram/mcp'],
  // The monorepo root, so files outside apps/web can be traced into a deployment.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // /api/evals lists the committed bench summaries.
  outputFileTracingIncludes: { '/api/evals': ['../../bench/reports/*.json'] },
  // The engine's database client stays a Node dependency, not bundled.
  serverExternalPackages: ['postgres'],
  // The engine uses NodeNext imports (`./client.js` for client.ts). Webpack can
  // map them; Turbopack, Next 16's default, can't, so build and dev use
  // --webpack (P09a task 1, ADR-019).
  webpack: (cfg: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return cfg;
  },
};

export default config;
