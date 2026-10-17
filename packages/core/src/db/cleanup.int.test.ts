import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupDemoNamespaces, ensureNamespace, getNamespace } from './namespaces.js';
import { testDb } from '../testing/db.js';
import { Scenario, aboutSelf } from '../testing/scenario.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

// Far in the future, so other test files' namespaces never count as expired.
const NOW = new Date('2999-01-02T00:00:00Z');
const slug = (name: string) => `cleanup-${name}-${randomUUID()}`;

describe('engram_cleanup_demo', () => {
  it('deletes expired demo namespaces with everything in them, and nothing else', async () => {
    const expired = await ensureNamespace(db, {
      slug: slug('expired'),
      kind: 'demo',
      expiresAt: new Date('2999-01-01T00:00:00Z'),
    });
    const atNow = await ensureNamespace(db, { slug: slug('at-now'), kind: 'demo', expiresAt: NOW });
    const live = await ensureNamespace(db, {
      slug: slug('live'),
      kind: 'demo',
      expiresAt: new Date('2999-01-03T00:00:00Z'),
    });
    const user = await ensureNamespace(db, {
      slug: slug('user'),
      kind: 'user',
      expiresAt: new Date('2999-01-01T00:00:00Z'),
    });
    // A fact and its entities too: facts reference entities without a cascade.
    await new Scenario(db, expired).tell({
      at: '2024-01-15T09:00:00Z',
      content: 'I live in Paris.',
      candidates: [aboutSelf('lives_in', 'Paris')],
    });

    try {
      expect(await cleanupDemoNamespaces(db, NOW)).toBeGreaterThanOrEqual(2);
      expect(await getNamespace(db, expired.namespace.id)).toBeUndefined();
      expect(await getNamespace(db, atNow.namespace.id)).toBeUndefined();
      expect(await getNamespace(db, live.namespace.id)).toBeDefined();
      expect(await getNamespace(db, user.namespace.id)).toBeDefined();
      const left = await db`
        select 1 from episodes where namespace_id = ${expired.namespace.id}
        union all select 1 from facts where namespace_id = ${expired.namespace.id}
        union all select 1 from fact_revisions where namespace_id = ${expired.namespace.id}
        union all select 1 from entities where namespace_id = ${expired.namespace.id}`;
      expect(left).toHaveLength(0);
    } finally {
      await db`delete from namespaces where id in (${live.namespace.id}, ${user.namespace.id})`;
    }
  });
});
