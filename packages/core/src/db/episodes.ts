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
  summarizes?: string[];
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
