import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, createDb } from './client.js';
import type { Sql } from './client.js';
import { one } from './rows.js';
import type { Values } from './rows.js';

// Raw SQL on purpose: these test the schema itself, not the repository layer.
const sql: Sql = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });
let ns: string;
let subject: string;

const CHECK = '23514';
const UNIQUE = '23505';

beforeAll(async () => {
  ns = one(
    await sql<{ id: string }[]>`
      insert into namespaces (slug) values (${`constraints-${randomUUID()}`}) returning id`,
  ).id;
  subject = one(
    await sql<{ id: string }[]>`
      insert into entities (namespace_id, name, type) values (${ns}, 'Sam', 'person') returning id`,
  ).id;
});

afterAll(async () => {
  await sql`delete from namespaces where id = ${ns}`;
  await sql.end();
});

/** A valid fact; each test breaks one thing. */
function fact(overrides: Values = {}): Values {
  return {
    namespaceId: ns,
    subjectId: subject,
    predicate: 'lives_in',
    objectLiteral: 'Paris',
    statement: 'Sam lives in Paris',
    validFrom: new Date('2024-01-01T00:00:00Z'),
    recordedAt: new Date('2024-06-01T00:00:00Z'),
    ...overrides,
  };
}

async function insertFact(overrides: Values = {}): Promise<void> {
  const row = fact(overrides);
  await sql`insert into facts ${sql(row, Object.keys(row))}`;
}

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe('facts constraints', () => {
  it('accept a valid fact', async () => {
    await expect(insertFact()).resolves.toBeUndefined();
  });

  it.each([
    ['neither object column set', { objectLiteral: null }],
    ['valid_to equal to valid_from', { validTo: new Date('2024-01-01T00:00:00Z') }],
    ['valid_to before valid_from', { validTo: new Date('2023-01-01T00:00:00Z') }],
    ['invalidated before recorded', { invalidatedAt: new Date('2024-05-01T00:00:00Z') }],
    ['unknown status', { status: 'deleted' }],
    ['unknown tier', { tier: 'cold' }],
    ['unknown valid_from_source', { validFromSource: 'guess' }],
    ['confidence above 1', { confidence: 1.5 }],
    ['negative access score', { accessScore: -1 }],
    ['an unknown source with a known start', { validFromSource: 'unknown' }],
    ['-infinity with a known source', { validFrom: '-infinity' }],
  ])('reject %s', async (_name, overrides) => {
    expect(await errorCode(insertFact(overrides))).toBe(CHECK);
  });

  it('accept an unknown start as -infinity', async () => {
    await expect(
      insertFact({ validFrom: '-infinity', validFromSource: 'unknown' }),
    ).resolves.toBeUndefined();
  });

  it('reject both object columns set', async () => {
    expect(await errorCode(insertFact({ objectId: subject }))).toBe(CHECK);
  });
});

describe('episode and revision constraints', () => {
  async function insertEpisode(overrides: Values): Promise<void> {
    const row: Values = {
      namespaceId: ns,
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      ...overrides,
    };
    await sql`insert into episodes ${sql(row, Object.keys(row))}`;
  }

  it.each([
    ['unknown role', { role: 'bot' }],
    ['unknown kind', { kind: 'note' }],
    ['importance above 1', { importance: 2 }],
  ])('episodes reject %s', async (_name, overrides) => {
    expect(await errorCode(insertEpisode(overrides))).toBe(CHECK);
  });

  it.each([
    ['unknown kind', { kind: 'delete', resolver: 'rule' }],
    ['unknown resolver', { kind: 'merge', resolver: 'human' }],
  ])('fact_revisions reject %s', async (_name, overrides) => {
    const row: Values = { namespaceId: ns, ...overrides };
    expect(await errorCode(sql`insert into fact_revisions ${sql(row, Object.keys(row))}`)).toBe(
      CHECK,
    );
  });

  it('namespaces reject an unknown kind', async () => {
    expect(
      await errorCode(sql`insert into namespaces (slug, kind) values (${randomUUID()}, 'admin')`),
    ).toBe(CHECK);
  });
});

describe('entity constraints', () => {
  it('allow only one self entity per namespace', async () => {
    await sql`insert into entities (namespace_id, name, is_self) values (${ns}, 'User', true)`;
    expect(
      await errorCode(
        sql`insert into entities (namespace_id, name, is_self) values (${ns}, 'Me', true)`,
      ),
    ).toBe(UNIQUE);
  });

  it('reject an unknown entity type', async () => {
    expect(
      await errorCode(
        sql`insert into entities (namespace_id, name, type) values (${ns}, 'X', 'animal')`,
      ),
    ).toBe(CHECK);
  });
});

describe('namespace deletion', () => {
  it('cascades through facts that reference each other and their revisions', async () => {
    const tmp = one(
      await sql<{ id: string }[]>`
      insert into namespaces (slug) values (${`cascade-${randomUUID()}`}) returning id`,
    ).id;
    const who = one(
      await sql<{ id: string }[]>`
      insert into entities (namespace_id, name) values (${tmp}, 'Sam') returning id`,
    ).id;
    const a = randomUUID();
    const b = randomUUID();
    const base: Values = {
      namespaceId: tmp,
      subjectId: who,
      predicate: 'lives_in',
      statement: 's',
    };
    const rows: Values[] = [
      { ...base, id: a, objectLiteral: 'Paris', validFrom: new Date('2020-01-01') },
      { ...base, id: b, objectLiteral: 'Berlin', validFrom: new Date('2024-01-01'), revises: a },
    ];
    await sql`insert into facts ${sql(rows, ['id', ...Object.keys(base), 'objectLiteral', 'validFrom', 'revises'])}`;
    await sql`update facts set superseded_by = ${b} where id = ${a}`;
    await sql`
      insert into fact_revisions (namespace_id, old_fact_id, new_fact_id, kind, resolver)
      values (${tmp}, ${a}, ${b}, 'update', 'rule')`;

    await sql`delete from namespaces where id = ${tmp}`;

    const [counts] = await sql<{ facts: number; revisions: number; entities: number }[]>`
      select
        (select count(*)::int from facts where namespace_id = ${tmp}) as facts,
        (select count(*)::int from fact_revisions where namespace_id = ${tmp}) as revisions,
        (select count(*)::int from entities where namespace_id = ${tmp}) as entities`;
    expect(counts).toEqual({ facts: 0, revisions: 0, entities: 0 });
  });
});
