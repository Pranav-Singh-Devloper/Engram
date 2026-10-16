// Recorded-fixture support (P02). `pnpm fixtures:record` runs each fixture
// conversation through the real pipeline with Gemini for structured calls and
// fake embeddings, and saves every structured call. Golden tests replay those
// calls through a FakeProvider, so they exercise real model output with no
// network. Embeddings stay fake on both sides so the replay takes exactly the
// same path as the recording.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTRACTS } from '../providers/contracts.js';
import type { MethodInput, MethodOutput, StructuredMethod } from '../providers/contracts.js';
import { FakeProvider, fakeEmbedding } from '../providers/fake.js';
import type { Provider } from '../providers/provider.js';
import type { EpisodeRole } from '../types/index.js';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../fixtures');
export const CONVERSATIONS_DIR = path.join(FIXTURES_DIR, 'conversations');
export const EXPECTED_DIR = path.join(FIXTURES_DIR, 'expected');

export interface FixtureEpisode {
  sessionId: string;
  role: EpisodeRole;
  content: string;
  occurredAt: string;
}

/** Ids differ on every run, so choices among candidates or facts are stored by position. */
export type RecordedCall =
  | { method: 'processEpisode'; input: unknown; output: MethodOutput<'processEpisode'> }
  | { method: 'disambiguate'; input: unknown; output: { choice: number | null; reason: string } }
  | {
      method: 'adjudicate';
      input: unknown;
      output: Omit<MethodOutput<'adjudicate'>, 'targetFactId'> & { target: number | null };
    };

export interface Recording {
  promptVersion: string;
  model: string;
  recordedAt: string;
  calls: RecordedCall[];
}

export interface FixtureConversation {
  id: string;
  /** What the fixture is meant to exercise. */
  covers: string;
  episodes: FixtureEpisode[];
  recording?: Recording;
}

export function loadConversations(): FixtureConversation[] {
  return readdirSync(CONVERSATIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map(
      (f) =>
        JSON.parse(readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf8')) as FixtureConversation,
    );
}

export function saveConversation(conversation: FixtureConversation): void {
  writeFileSync(
    path.join(CONVERSATIONS_DIR, `${conversation.id}.json`),
    `${JSON.stringify(conversation, null, 2)}\n`,
  );
}

/** A canonical form of a method input: parsed (so key order follows the schema), ids dropped. */
function canonical<M extends StructuredMethod>(method: M, input: MethodInput<M>): string {
  const parsed = CONTRACTS[method].input.parse(input) as Record<string, unknown>;
  const withoutIds = (items: { id: string }[]) => items.map(({ id: _id, ...rest }) => rest);
  if (method === 'disambiguate') {
    const { candidates } = parsed as { candidates: { id: string }[] };
    return JSON.stringify({ ...parsed, candidates: withoutIds(candidates) });
  }
  if (method === 'adjudicate') {
    const { existing } = parsed as { existing: { id: string }[] };
    return JSON.stringify({ ...parsed, existing: withoutIds(existing) });
  }
  return JSON.stringify(parsed);
}

/** Wraps a real provider: structured calls go through and are recorded; embeddings are fake. */
export function recordingProvider(real: Provider, calls: RecordedCall[]): Provider {
  return {
    name: `recording(${real.name})`,
    embed: (texts) => Promise.resolve(texts.map(fakeEmbedding)),
    processEpisode: async (input) => {
      const output = await real.processEpisode(input);
      calls.push({
        method: 'processEpisode',
        input: JSON.parse(canonical('processEpisode', input)),
        output,
      });
      return output;
    },
    disambiguate: async (input) => {
      const output = await real.disambiguate(input);
      const index = input.candidates.findIndex((c) => c.id === output.entityId);
      calls.push({
        method: 'disambiguate',
        input: JSON.parse(canonical('disambiguate', input)),
        output: { choice: index === -1 ? null : index, reason: output.reason },
      });
      return output;
    },
    adjudicate: async (input) => {
      const output = await real.adjudicate(input);
      const { targetFactId, ...rest } = output;
      const index = input.existing.findIndex((e) => e.id === targetFactId);
      calls.push({
        method: 'adjudicate',
        input: JSON.parse(canonical('adjudicate', input)),
        output: { ...rest, target: index === -1 ? null : index },
      });
      return output;
    },
    summarize: (input) => real.summarize(input),
    compose: (input) => real.compose(input),
    judge: (input) => real.judge(input),
  };
}

/** A FakeProvider that answers exactly the recorded calls, and nothing else. */
export function replayProvider(recording: Recording): FakeProvider {
  const fake = new FakeProvider();
  for (const call of recording.calls) {
    const key = JSON.stringify(call.input);
    if (call.method === 'processEpisode') {
      fake.when(
        'processEpisode',
        (input) => canonical('processEpisode', input) === key,
        call.output,
      );
    } else if (call.method === 'adjudicate') {
      const { target, ...rest } = call.output;
      fake.when(
        'adjudicate',
        (input) => canonical('adjudicate', input) === key,
        (input) => ({
          ...rest,
          targetFactId: target === null ? null : (input.existing[target]?.id ?? null),
        }),
      );
    } else {
      const { choice, reason } = call.output;
      fake.when(
        'disambiguate',
        (input) => canonical('disambiguate', input) === key,
        (input) => ({
          entityId: choice === null ? null : (input.candidates[choice]?.id ?? null),
          reason,
        }),
      );
    }
  }
  return fake;
}
