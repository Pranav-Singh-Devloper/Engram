// Read endpoints (SPEC §11, §12; P09a decision 5). Reads never track access:
// browsing a memory isn't using it (§6.2 rule 7).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BenchSummary, history, retentionScore, uuidArray } from '@engram/core';
import type { Sql } from '@engram/core';
import { z } from 'zod';
import type { Access } from './auth';

const MemoriesQuery = z.object({
  tier: z.enum(['working', 'long_term', 'archived']).optional(),
  // A display filter for the inspector. "Current" itself is decided on time
  // columns (invalidated_at), never on status (CLAUDE.md).
  status: z.enum(['active', 'superseded', 'retracted', 'revised']).optional(),
  predicate: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(),
  /** Include replaced versions too (the record-time audit view). */
  all: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Most rows ranked per request; ranking happens in TS with the decay sweep's own formula. */
const RANK_WINDOW = 2_000;

const badRequest = (error: z.ZodError) =>
  Response.json({ error: 'Invalid query.', issues: z.treeifyError(error) }, { status: 400 });

interface MemoryRow {
  id: string;
  statement: string;
  predicate: string;
  subjectId: string;
  subjectName: string;
  objectId: string | null;
  objectName: string;
  tier: 'working' | 'long_term' | 'archived';
  status: string;
  importance: number;
  accessScore: number;
  lastAccessedAt: Date | null;
  pinned: boolean;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  invalidatedAt: Date | null;
  sourceEpisodeIds: string[];
}

/** GET /api/memories: facts filtered and sorted by retention score, with provenance. */
export async function listMemories(
  db: Sql,
  access: Access,
  url: URL,
  now: Date,
): Promise<Response> {
  const parsed = MemoriesQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  const p = parsed.data;
  const rows = await db<MemoryRow[]>`
    select f.id, f.statement, f.predicate, f.subject_id, s.name as subject_name, f.object_id,
           coalesce(o.name, f.object_literal) as object_name, f.tier, f.status, f.importance,
           f.access_score, f.last_accessed_at, f.pinned, f.valid_from, f.valid_to,
           f.recorded_at, f.invalidated_at, f.source_episode_ids
    from facts f
    join entities s on s.id = f.subject_id
    left join entities o on o.id = f.object_id
    where f.namespace_id = ${access.namespaceId}
      ${p.all === 'true' ? db`` : db`and f.invalidated_at is null`}
      ${p.tier ? db`and f.tier = ${p.tier}` : db``}
      ${p.status ? db`and f.status = ${p.status}` : db``}
      ${p.predicate ? db`and f.predicate = ${p.predicate}` : db``}
      ${p.q ? db`and to_tsvector('english', f.statement) @@ websearch_to_tsquery('english', ${p.q})` : db``}
    order by f.recorded_at desc
    limit ${RANK_WINDOW}`;
  const ranked = rows
    .map((r) => ({ ...r, retention: retentionScore(r, now) }))
    .sort((a, b) => b.retention - a.retention || a.id.localeCompare(b.id));
  const page = ranked.slice(p.offset, p.offset + p.limit);

  const sourceIds = [...new Set(page.flatMap((r) => r.sourceEpisodeIds))];
  const sources =
    sourceIds.length === 0
      ? []
      : await db<{ id: string; role: string; content: string; occurredAt: Date }[]>`
          select id, role, content, occurred_at from episodes
          where namespace_id = ${access.namespaceId} and id = any(${uuidArray(db, sourceIds)}::uuid[])`;
  const byId = new Map(sources.map((s) => [s.id, s]));
  return Response.json({
    total: ranked.length,
    truncated: rows.length === RANK_WINDOW,
    memories: page.map(({ sourceEpisodeIds, accessScore, lastAccessedAt, ...m }) => ({
      ...m,
      accessScore,
      lastAccessedAt,
      sources: sourceEpisodeIds.flatMap((id) => byId.get(id) ?? []),
    })),
  });
}

const TimelineQuery = z.object({
  predicate: z.string().min(1).max(100).optional(),
  includeRevised: z.enum(['true', 'false']).optional(),
});

/** GET /api/entities/:id/timeline: the entity's facts over valid and record time. */
export async function entityTimeline(
  db: Sql,
  access: Access,
  entityId: string,
  url: URL,
): Promise<Response> {
  if (!z.uuid().safeParse(entityId).success) return notFound();
  const parsed = TimelineQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  const [entity] = await db<
    {
      id: string;
      name: string;
      type: string;
      description: string | null;
      aliases: string[];
      isSelf: boolean;
    }[]
  >`select id, name, type, description, aliases, is_self from entities
    where id = ${entityId} and namespace_id = ${access.namespaceId}`;
  // Another namespace's entity is indistinguishable from a missing one.
  if (!entity) return notFound();
  const entries = await history(db, access.namespaceId, entityId, {
    predicate: parsed.data.predicate,
    includeRevised: parsed.data.includeRevised === 'true',
  });
  return Response.json({ entity, entries });
}

const notFound = () => Response.json({ error: 'Not found.' }, { status: 404 });

const AgreementFile = z.object({
  runs: z.array(z.string()),
  pooled: z.object({
    n: z.number(),
    agreement: z.number(),
    kappa: z.number().nullable(),
    humanCorrect: z.number(),
    humanIncorrect: z.number(),
    judgeTooLenient: z.number(),
    judgeTooStrict: z.number(),
  }),
});

/** GET /api/evals: every bench run's summary, newest first, and the latest judge agreement. Public (no personal data). */
export function listEvals(reportsDir: string | null): Response {
  if (!reportsDir) return Response.json({ runs: [], agreement: null });
  let files: string[];
  try {
    files = readdirSync(reportsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return Response.json({ runs: [], agreement: null });
  }
  const read = (f: string): unknown => {
    try {
      return JSON.parse(readFileSync(path.join(reportsDir, f), 'utf8'));
    } catch {
      return null;
    }
  };
  const runs = files
    .filter((f) => !f.startsWith('agreement-'))
    .flatMap((f) => {
      const parsed = BenchSummary.safeParse(read(f));
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const agreements = files
    .filter((f) => f.startsWith('agreement-'))
    .flatMap((f) => {
      const parsed = AgreementFile.safeParse(read(f));
      return parsed.success ? [parsed.data] : [];
    })
    // The widest pooled sheet is the one to show.
    .sort((a, b) => b.pooled.n - a.pooled.n);
  return Response.json({ runs, agreement: agreements[0] ?? null });
}
