// POST /api/remember and /api/recall (SPEC §11): the REST face of MCP's
// engram_remember and engram_recall, with the same input names and limits.
// Bearer-only; a token reads and writes only its own namespace.
import { ingest, processEpisode, recall } from '@engram/core';
import type { Clock, Provider, Sql } from '@engram/core';
import { z } from 'zod';
import type { Access } from './auth';

const isoDate = z.iso.datetime({ offset: true });

const RememberBody = z.object({
  content: z.string().trim().min(1).max(8000),
  session_id: z.string().trim().min(1).max(200).optional(),
  occurred_at: isoDate.optional(),
  /** false (default): store now, extract after the response is sent. */
  wait: z.boolean().default(false),
});

const RecallBody = z.object({
  query: z.string().trim().min(1).max(1000),
  k: z.number().int().min(1).max(20).default(8),
  valid_at: isoDate.optional(),
  known_at: isoDate.optional(),
  include_archived: z.boolean().default(false),
});

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? parsed.data
    : Response.json(
        { error: 'Invalid body.', issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
}

const readOnly = () => Response.json({ error: 'This namespace is read-only.' }, { status: 403 });

export interface WriteDeps {
  db: Sql;
  provider: Provider;
  clock: Clock;
  defer: (task: () => Promise<void>) => void;
}

export async function remember(deps: WriteDeps, access: Access, req: Request): Promise<Response> {
  if (!access.writable) return readOnly();
  const b = await body(req, RememberBody);
  if (b instanceof Response) return b;
  const { db, provider, clock } = deps;
  const now = clock.now();
  const sessionId = b.session_id ?? `api-${now.toISOString().slice(0, 10)}`;
  const episode = await ingest(
    db,
    provider,
    {
      namespaceId: access.namespaceId,
      sessionId,
      role: 'user',
      content: b.content,
      occurredAt: b.occurred_at ? new Date(b.occurred_at) : now,
    },
    { clock },
  );
  if (!b.wait) {
    // An unprocessed episode is swept up later (MCP start-up, nightly jobs) if this is lost.
    deps.defer(async () => {
      await processEpisode(db, provider, episode.id, { clock });
    });
    return Response.json(
      { episode_id: episode.id, session_id: sessionId, status: 'pending' },
      { status: 202 },
    );
  }
  const s = await processEpisode(db, provider, episode.id, { clock });
  return Response.json({
    episode_id: episode.id,
    session_id: sessionId,
    status: s.status,
    extracted: s.extracted,
    outcomes: s.outcomes,
  });
}

export async function recallRoute(
  deps: WriteDeps,
  access: Access,
  req: Request,
): Promise<Response> {
  const b = await body(req, RecallBody);
  if (b instanceof Response) return b;
  const r = await recall(
    deps.db,
    deps.provider,
    {
      namespaceId: access.namespaceId,
      query: b.query,
      k: b.k,
      validAt: b.valid_at ? new Date(b.valid_at) : undefined,
      knownAt: b.known_at ? new Date(b.known_at) : undefined,
      includeArchived: b.include_archived,
      // An agent's recall uses what it gets back, as MCP's does (SPEC §6.2 rule 7).
      trackAccess: true,
    },
    deps.clock,
  );
  return Response.json({
    abstained: r.abstained,
    memories: r.memories.map((m) => ({
      id: m.id,
      kind: m.kind,
      text: m.text,
      status: m.status,
      valid_from: m.validFrom,
      valid_to: m.validTo,
      recorded_at: m.recordedAt,
      score: m.score,
    })),
  });
}
