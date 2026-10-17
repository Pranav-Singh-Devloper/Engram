import type { Queryable } from './client.js';
import { defined, maybeOne, one } from './rows.js';
import { fromSql, toSql } from './vector.js';
import type { Episode, EpisodeKind, EpisodeRole } from '../types/index.js';

type EpisodeRow = Omit<Episode, 'embedding'> & { embedding: string | null };

function parseEpisode(row: EpisodeRow): Episode {
  return { ...row, embedding: row.embedding === null ? null : fromSql(row.embedding) };
}

export interface NewEpisode {
  id?: string;
  namespaceId: string;
  sessionId: string;
  kind?: EpisodeKind;
  role: EpisodeRole;
  content: string;
  embedding?: readonly number[] | null;
  importance?: number;
  occurredAt?: Date;
  /** Record time; defaults to the database's now(). The engine passes its clock. */
  createdAt?: Date;
  summarizes?: string[];
  /** Set for episodes that are never extracted, such as consolidation summaries. */
  processedAt?: Date;
  consolidated?: boolean;
}

export async function insertEpisode(db: Queryable, episode: NewEpisode): Promise<Episode> {
  const values = defined({
    ...episode,
    embedding: episode.embedding == null ? episode.embedding : toSql(episode.embedding),
  });
  return parseEpisode(one(await db<EpisodeRow[]>`insert into episodes ${db(values)} returning *`));
}

export async function getEpisode(db: Queryable, id: string): Promise<Episode | undefined> {
  const row = maybeOne(await db<EpisodeRow[]>`select * from episodes where id = ${id}`);
  return row && parseEpisode(row);
}

/**
 * Marks extraction finished and stores the LLM-scored importance. Returns
 * false if another run got there first.
 */
export async function markEpisodeProcessed(
  db: Queryable,
  id: string,
  change: { at: Date; importance?: number },
): Promise<boolean> {
  const rows = await db`
    update episodes
    set processed_at = ${change.at}, importance = coalesce(${change.importance ?? null}::real, importance)
    where id = ${id} and processed_at is null
    returning id`;
  return rows.length === 1;
}
