// The interfaces chapter lists every API route that exists (and no other), with
// the methods its route file exports, and the server's real demo limits.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFromEnv } from '@/server/config';
import { LIMITS } from '@/server/limits';
import { DEMO_LIMITS, MCP_CATALOG, ROUTES } from './interfaces';

const API = path.resolve(import.meta.dirname, '../../../app/api');

function routeFiles(dir: string, prefix = '/api'): { path: string; methods: string[] }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}/${name}`);
    if (name !== 'route.ts') return [];
    const src = readFileSync(full, 'utf8');
    const methods = [
      ...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g),
    ].map((m) => m[1] ?? '');
    return [{ path: prefix, methods }];
  });
}

describe('interfaces chapter data', () => {
  it('lists exactly the API routes in app/api, with their methods', () => {
    const files = routeFiles(API).sort((a, b) => a.path.localeCompare(b.path));
    const listed = ROUTES.map((r) => ({ path: r.path, methods: r.methods })).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    expect(listed.map((r) => ({ ...r, methods: [...r.methods].sort() }))).toEqual(
      files.map((r) => ({ ...r, methods: [...r.methods].sort() })),
    );
  });

  it('shows the limits the server enforces', () => {
    expect(DEMO_LIMITS).toEqual({ ...LIMITS, dailyTurnCap: configFromEnv({}).dailyTurnCap });
  });

  it('lists the six MCP tools and the stats resource, as the server reports them', () => {
    expect(MCP_CATALOG.tools.map((t) => t.name)).toEqual([
      'engram_remember',
      'engram_recall',
      'engram_history',
      'engram_entities',
      'engram_forget',
      'engram_consolidate',
    ]);
    expect(MCP_CATALOG.resources.map((r) => r.uri)).toEqual(['engram://stats']);
    const forget = MCP_CATALOG.tools.find((t) => t.name === 'engram_forget');
    expect(forget?.annotations.destructiveHint).toBe(true);
  });
});
