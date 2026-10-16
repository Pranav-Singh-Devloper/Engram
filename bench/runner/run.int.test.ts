import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeProvider, ProviderHttpError, SELF_REF } from '@engram/core';
import type { MethodInput } from '@engram/core';
import { testDb } from '@engram/core/testing';
import type { BenchItem } from '../dataset/schema.js';
import { runMode } from './modes.js';
import { QuotaStop, loadResults, runItems } from './run.js';

const db = testDb();
const dirs: string[] = [];
afterAll(async () => {
  await db.end();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const item: BenchItem = {
  id: 'dev-test-1',
  split: 'dev',
  category: 'temporal_reasoning',
  persona: 'p1',
  setup_sessions: [
    { session_id: 'p1-s1', occurred_at: '2024-02-11T09:00:00.000Z', turns: ['I live in Krakow.'] },
    {
      session_id: 'p1-s3',
      occurred_at: '2024-06-18T09:00:00.000Z',
      turns: ['I moved to Osaka in May.'],
    },
  ],
  question: 'Where was I living in March 2024?',
  asked_at: '2024-07-01T00:00:00.000Z',
  valid_at: '2024-03-22T00:00:00.000Z',
  known_at: null,
  expected: 'Krakow',
  judge: 'contains',
  notes: '',
};

function fake(): FakeProvider {
  const self = { name: SELF_REF, type: 'person', description: null } as const;
  const city = (name: string) =>
    ({ kind: 'entity', entity: { name, type: 'place', description: null } }) as const;
  return new FakeProvider()
    .when('processEpisode', 'Krakow', {
      importance: 0.5,
      candidates: [
        {
          subject: self,
          predicate: 'lives_in',
          object: city('Krakow'),
          statement: 'The user lives in Krakow.',
          validFrom: { kind: 'none' },
          validTo: { kind: 'none' },
          isCorrection: false,
          confidence: 0.9,
        },
      ],
    })
    .when('processEpisode', 'Osaka', {
      importance: 0.7,
      candidates: [
        {
          subject: self,
          predicate: 'lives_in',
          object: city('Osaka'),
          statement: 'The user lives in Osaka.',
          validFrom: { kind: 'named_period', year: null, month: 5, season: null },
          validTo: { kind: 'none' },
          isCorrection: false,
          confidence: 0.9,
        },
      ],
    })
    .when(
      'compose',
      () => true,
      (input) => {
        const facts = input.memories
          .filter((m) => m.kind === 'fact')
          .map((m) => m.text)
          .join(' ');
        return { answer: facts || 'nothing', supported: facts.length > 0, usedMemoryIds: [] };
      },
    );
}

describe('memory modes', () => {
  it('engram replays the history and recalls only what held at valid_at', async () => {
    const provider = fake();
    const answer = await runMode('engram', item, { db, provider });
    expect(answer.answer).toContain('Krakow');
    expect(answer.answer).not.toContain('Osaka');
    expect(answer.store).toMatchObject({ entities: 2, duplicateEntities: 0 });
    // The namespace is cleaned up afterwards.
    expect(await db`select 1 from namespaces where slug like ${'bench-dev-test-1-%'}`).toHaveLength(
      0,
    );
  });

  it('the baselines see dated turns and no facts', async () => {
    for (const mode of ['buffer', 'full_context', 'rag'] as const) {
      const provider = fake();
      const answer = await runMode(mode, item, { db, provider });
      expect(answer).toMatchObject({ supported: false, memories: 2 });
      const [input] = provider.callsTo('compose') as MethodInput<'compose'>[];
      expect(input?.memories.every((m) => m.kind === 'episode')).toBe(true);
    }
  });
});

describe('runItems', () => {
  it('writes one result per mode and item, and skips existing ones on resume', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'engram-run-'));
    dirs.push(dir);
    const provider = fake();
    expect(await runItems([item], ['full_context', 'engram'], { db, provider, dir })).toBe(2);
    const results = loadResults(dir);
    expect(results.map((r) => [r.mode, r.verdict.correct]).sort()).toEqual([
      ['engram', true],
      ['full_context', false],
    ]);
    const composes = provider.callsTo('compose').length;
    expect(await runItems([item], ['full_context', 'engram'], { db, provider, dir })).toBe(0);
    expect(provider.callsTo('compose')).toHaveLength(composes);
  });

  it('stops cleanly when a rate limit outlasts the backoff', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'engram-run-'));
    dirs.push(dir);
    const limited = fake();
    limited.compose = () => Promise.reject(new ProviderHttpError('HTTP 429: daily quota', 429, 6));
    await expect(
      runItems([item], ['full_context'], { db, provider: limited, dir }),
    ).rejects.toThrow(QuotaStop);
    expect(loadResults(dir)).toHaveLength(0);
  });
});
