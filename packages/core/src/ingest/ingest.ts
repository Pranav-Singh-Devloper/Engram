import type { Clock } from '../config/clock.js';
import type { Queryable } from '../db/client.js';
import { insertEpisode } from '../db/episodes.js';
import type { Provider } from '../providers/provider.js';
import type { Episode, EpisodeRole } from '../types/index.js';

export interface IngestInput {
  namespaceId: string;
  sessionId: string;
  role: EpisodeRole;
  content: string;
  /** When it happened; defaults to now. Bench replays pass historical times. */
  occurredAt?: Date;
}

/**
 * The fast half of the write path (SPEC §6.1): store the episode with its
 * embedding and return it. Extraction runs later in `process`, which sets
 * `processed_at` and the LLM-scored importance. Tool output is stored and
 * embedded like any turn; only extraction skips it.
 */
export async function ingest(
  db: Queryable,
  provider: Pick<Provider, 'embed'>,
  input: IngestInput,
  options: { clock?: Clock } = {},
): Promise<Episode> {
  if (input.content.trim() === '') throw new Error('Episode content is empty.');
  if (input.sessionId.trim() === '') throw new Error('Episode session id is empty.');

  const [embedding] = await provider.embed([input.content], { purpose: 'document' });
  // created_at is the episode's record time (SPEC §5.1): when the system learned it.
  return insertEpisode(db, {
    ...input,
    embedding: embedding ?? null,
    createdAt: options.clock?.now(),
  });
}

/**
 * Bulk ingest (imports, bench replays): one embedding request for many
 * episodes (the provider batches 100 a request) instead of one per turn.
 * Each input may carry its own record time.
 */
export async function ingestMany(
  db: Queryable,
  provider: Pick<Provider, 'embed'>,
  inputs: readonly (IngestInput & { createdAt?: Date })[],
): Promise<Episode[]> {
  for (const input of inputs) {
    if (input.content.trim() === '') throw new Error('Episode content is empty.');
    if (input.sessionId.trim() === '') throw new Error('Episode session id is empty.');
  }
  if (inputs.length === 0) return [];
  const vectors = await provider.embed(
    inputs.map((i) => i.content),
    { purpose: 'document' },
  );
  const out: Episode[] = [];
  for (const [i, input] of inputs.entries()) {
    out.push(await insertEpisode(db, { ...input, embedding: vectors[i] ?? null }));
  }
  return out;
}
