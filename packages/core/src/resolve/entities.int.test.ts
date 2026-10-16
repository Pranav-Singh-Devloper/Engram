import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { getEntity, insertEntity } from '../db/entities.js';
import { cosine } from '../db/vector.js';
import type { EntityRef } from '../providers/contracts.js';
import { FakeProvider, fakeEmbedding } from '../providers/fake.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import { entityLabel, resolveEntity } from './entities.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const ref = (name: string, type: EntityRef['type'] = null, description: string | null = null) => ({
  name,
  type,
  description,
});

/** Resolves with a Fake that fails the test if disambiguation is attempted. */
function resolve(ns: NamespaceWithSelf, mention: EntityRef, fake = new FakeProvider()) {
  return resolveEntity(db, fake, mention, fakeEmbedding(entityLabel(mention)), {
    namespaceId: ns.namespace.id,
    selfEntity: ns.selfEntity,
    context: 'test turn',
  });
}

async function seed(ns: NamespaceWithSelf, mention: EntityRef, aliases: string[] = []) {
  return insertEntity(db, {
    namespaceId: ns.namespace.id,
    name: mention.name,
    type: mention.type,
    description: mention.description,
    aliases,
    embedding: fakeEmbedding(entityLabel(mention)),
  });
}

describe('resolveEntity ladder', () => {
  it('maps SELF to the namespace self entity', async () => {
    await withTestNamespace(db, async (ns) => {
      const r = await resolve(ns, ref('self', 'person'));
      expect(r).toMatchObject({ entity: { id: ns.selfEntity.id }, created: false, via: 'self' });
    });
  });

  it('creates an entity when nothing matches, with the name cleaned', async () => {
    await withTestNamespace(db, async (ns) => {
      const r = await resolve(ns, ref('  New   York ', 'place', 'a city in the US'));
      expect(r).toMatchObject({
        created: true,
        via: 'new',
        entity: { name: 'New York', type: 'place' },
      });
      expect(r.entity.embedding).not.toBeNull();
    });
  });

  it('matches an exact name case-insensitively', async () => {
    await withTestNamespace(db, async (ns) => {
      const berlin = await seed(ns, ref('Berlin', 'place'));
      const r = await resolve(ns, ref('BERLIN', 'place'));
      expect(r).toMatchObject({ entity: { id: berlin.id }, created: false, via: 'exact' });
    });
  });

  it('treats a missing type as compatible with any type', async () => {
    await withTestNamespace(db, async (ns) => {
      const berlin = await seed(ns, ref('Berlin', 'place'));
      expect((await resolve(ns, ref('Berlin'))).entity.id).toBe(berlin.id);
    });
  });

  it('does not match the same name with a different type', async () => {
    await withTestNamespace(db, async (ns) => {
      const city = await seed(ns, ref('Paris', 'place'));
      const r = await resolve(ns, ref('Paris', 'person'));
      expect(r.created).toBe(true);
      expect(r.entity.id).not.toBe(city.id);
    });
  });

  it('matches an alias', async () => {
    await withTestNamespace(db, async (ns) => {
      const robert = await seed(ns, ref('Robert', 'person', "the user's brother"), ['Rob']);
      const r = await resolve(ns, ref('rob', 'person'));
      expect(r).toMatchObject({ entity: { id: robert.id }, via: 'alias' });
    });
  });

  it('matches by label similarity and learns the new surface form as an alias', async () => {
    await withTestNamespace(db, async (ns) => {
      const existing = ref('Acme Corp', 'org', "the user's employer, a robotics company in Ohio");
      const mention = ref(
        'Acme Corporation',
        'org',
        "the user's employer, a robotics company in Ohio",
      );
      const sim = cosine(fakeEmbedding(entityLabel(existing)), fakeEmbedding(entityLabel(mention)));
      expect(sim).toBeGreaterThanOrEqual(config.entities.matchThreshold);

      const acme = await seed(ns, existing);
      const r = await resolve(ns, mention);
      expect(r).toMatchObject({ entity: { id: acme.id }, via: 'embedding', created: false });
      expect((await getEntity(db, acme.id))?.aliases).toEqual(['Acme Corporation']);
    });
  });

  it('fills in a missing description on an exact match', async () => {
    await withTestNamespace(db, async (ns) => {
      const sam = await seed(ns, ref('Sam', 'person'));
      await resolve(ns, ref('Sam', 'person', "the user's brother"));
      const after = await getEntity(db, sam.id);
      expect(after?.description).toBe("the user's brother");
      expect(after?.aliases).toEqual([]);
    });
  });

  it('keeps an existing description', async () => {
    await withTestNamespace(db, async (ns) => {
      const sam = await seed(ns, ref('Sam', 'person', "the user's brother"));
      await resolve(ns, ref('Sam', 'person'));
      expect((await getEntity(db, sam.id))?.description).toBe("the user's brother");
    });
  });
});

describe('the embedding rung', () => {
  it('never merges different names whose generic descriptions look alike', async () => {
    await withTestNamespace(db, async (ns) => {
      const description = 'the company the user works for';
      const acme = await seed(ns, ref('Acme Robotics', 'org', description));
      const r = await resolve(ns, ref('Initech', 'org', description));
      expect(r.created).toBe(true);
      expect(r.entity.id).not.toBe(acme.id);
      expect((await getEntity(db, acme.id))?.aliases).toEqual([]);
    });
  });
});

describe('description drift', () => {
  it("doesn't split a place whose description changed with the user's relationship to it", async () => {
    await withTestNamespace(db, async (ns) => {
      const city = await seed(ns, ref('Melbourne', 'place', 'a city in Australia'));
      const r = await resolve(
        ns,
        ref('Melbourne', 'place', 'the city the user currently lives in'),
      );
      expect(r).toMatchObject({ entity: { id: city.id }, via: 'exact', created: false });
    });
  });
});
