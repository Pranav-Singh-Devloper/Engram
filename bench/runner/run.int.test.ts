import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeProvider, ProviderHttpError, SELF_REF } from '@engram/core';
import type { ConsolidatedCandidate, MethodInput } from '@engram/core';
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
    const answer = await runMode('engram', item, { db, provider, recall: { floor: 0 } });
    expect(answer.answer).toContain('Krakow');
    expect(answer.answer).not.toContain('Osaka');
    expect(answer.store).toMatchObject({ entities: 2, duplicateEntities: 0 });
    // Fake embeddings are bag-of-words, so the real-model floor is lifted.
    // The namespace is cleaned up afterwards.
    expect(await db`select 1 from namespaces where slug like ${'bench-dev-test-1-%'}`).toHaveLength(
      0,
    );
  });

  it('engram_consolidated summarizes each session after it ends and promotes its facts', async () => {
    const provider = fake().when(
      'summarize',
      () => true,
      (input) => ({
        summary: `Summary: ${input.episodes.map((e) => e.content).join(' ')}`,
        candidates: [],
      }),
    );
    const answer = await runMode('engram_consolidated', item, {
      db,
      provider,
      recall: { floor: 0 },
    });
    expect(answer.answer).toContain('Krakow');
    expect(answer.consolidation).toMatchObject({ summarized: 2, skipped: 0 });
    // Session 1 is consolidated before session 2 is told, so each summary sees one session.
    const inputs = provider.callsTo('summarize') as MethodInput<'summarize'>[];
    expect(inputs.map((i) => i.episodes.map((e) => e.content))).toEqual([
      ['I live in Krakow.'],
      ['I moved to Osaka in May.'],
    ]);
    expect(answer.retrieved?.some((t) => t.startsWith('Summary:'))).toBe(true);
  });

  it('engram_consolidated promotes the facts its summaries confirm, history included', async () => {
    const self = { name: SELF_REF, type: 'person', description: null } as const;
    const provider = fake().when(
      'summarize',
      () => true,
      (input) => ({
        summary: 'Where the user lives.',
        candidates: input.episodes.map((e): ConsolidatedCandidate => {
          const city = e.content.includes('Krakow') ? 'Krakow' : 'Osaka';
          return {
            subject: self,
            predicate: 'lives_in',
            object: { kind: 'entity', entity: { name: city, type: 'place', description: null } },
            statement: `The user lives in ${city}.`,
            validFrom:
              city === 'Osaka'
                ? { kind: 'named_period', year: null, month: 5, season: null }
                : { kind: 'none' },
            validTo: { kind: 'none' },
            isCorrection: false,
            confidence: 0.9,
            sourceEpisodeIds: [e.id],
          } as const;
        }),
      }),
    );
    const answer = await runMode('engram_consolidated', item, {
      db,
      provider,
      recall: { floor: 0 },
    });
    // Each confirmation cites the fact's own turn: merged, never double-counted.
    expect(answer.consolidation).toMatchObject({ promoted: 2, outcomes: { merged: 2 } });
    // Osaka, and the closed Krakow history row the update copied from a long_term fact.
    expect(answer.consolidation?.longTermFacts).toBe(2);
    expect(answer.answer).toContain('Krakow');
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
    expect(
      await runItems([item], ['full_context', 'engram'], {
        db,
        provider,
        dir,
        recall: { floor: 0 },
      }),
    ).toBe(2);
    const results = loadResults(dir);
    expect(results.map((r) => [r.mode, r.verdict.correct]).sort()).toEqual([
      ['engram', true],
      ['full_context', false],
    ]);
    const composes = provider.callsTo('compose').length;
    expect(
      await runItems([item], ['full_context', 'engram'], {
        db,
        provider,
        dir,
        recall: { floor: 0 },
      }),
    ).toBe(0);
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
