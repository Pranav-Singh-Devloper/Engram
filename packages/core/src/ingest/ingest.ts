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
