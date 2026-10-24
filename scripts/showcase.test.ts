// The showcase seed on the local database, with scripted extraction: it
// verifies the story's answers, refuses to overwrite, and rebuilds on replace.
import { randomUUID } from 'node:crypto';
import { DEFAULT_DATABASE_URL, createDb } from '@engram/core';
import { PORTABLE, migrate } from '@engram/core/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_GAPS, ShowcaseExistsError, seedShowcase } from './showcase.js';

const db = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 2 });
const slug = `showcase-test-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  await migrate(db, { sources: [PORTABLE] });
});

afterAll(async () => {
  await db`delete from namespaces where slug = ${slug}`;
  await db.end();
});

describe('seedShowcase', () => {
  it('seeds the story and every canonical answer matches', async () => {
    const r = await seedShowcase(db, { slug });
    expect(r.answers.length).toBeGreaterThan(5);
    expect(r.answers.every((a) => a.ok)).toBe(true);
    expect(r.invariantProblems).toEqual([]);
    expect(r.facts).toBeGreaterThan(5);
    const [ns] = await db<{ kind: string; expiresAt: Date | null }[]>`
      select kind, expires_at from namespaces where slug = ${slug}`;
    // Not a demo namespace, so the nightly cleanup never deletes it.
    expect(ns).toEqual({ kind: 'user', expiresAt: null });
  }, 60_000);

  it('refuses to overwrite an existing showcase', async () => {
    await expect(seedShowcase(db, { slug })).rejects.toBeInstanceOf(ShowcaseExistsError);
  });

  it('allows only the documented live gap, never a wrong answer', () => {
    expect(Object.keys(LIVE_GAPS)).toEqual(['Where did they live in 2010?']);
  });

  it('rebuilds it on replace, with a new namespace', async () => {
    const [before] = await db<{ id: string }[]>`select id from namespaces where slug = ${slug}`;
    const r = await seedShowcase(db, { slug, replace: true });
    expect(r.namespaceId).not.toBe(before?.id);
    expect(r.answers.every((a) => a.ok && !a.gap)).toBe(true);
    const rows = await db<
      { id: string }[]
    >`select id from namespaces where slug like ${`${slug}%`}`;
    expect(rows.map((x) => x.id)).toEqual([r.namespaceId]);
  }, 60_000);

  it('keeps the old showcase when a rebuild fails', async () => {
    const [before] = await db<{ id: string }[]>`select id from namespaces where slug = ${slug}`;
    const broken = { embed: () => Promise.reject(new Error('offline')) } as never;
    await expect(seedShowcase(db, { slug, replace: true, provider: broken })).rejects.toThrow();
    const after = await db<
      { id: string }[]
    >`select id from namespaces where slug like ${`${slug}%`}`;
    expect(after.map((x) => x.id)).toEqual([before?.id]);
  });
});
