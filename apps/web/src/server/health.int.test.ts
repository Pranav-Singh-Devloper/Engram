import { testDb } from '@engram/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { testRoutes } from './testing';

const db = testDb();
afterAll(async () => {
  await db.end();
});

describe('GET /api/health', () => {
  it('resolves unqualified names to the engram schema', async () => {
    const res = await testRoutes(db).routes.health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, schema: 'engram' });
  });
});
