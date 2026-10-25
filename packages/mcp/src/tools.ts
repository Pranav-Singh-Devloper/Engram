// The six Engram tools (SPEC §10). Each is scoped to one namespace, returns
// deterministic text plus structured content, and says in its description
// when an agent should call it.
import {
  ForgetError,
  consolidate,
  forget,
  history,
  ingest,
  normalizePredicate,
  processEpisode,
  processPending,
  recall,
  searchEntities,
} from '@engram/core';
import type { Clock, Provider, Sql } from '@engram/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  boundJson,
  counts,
  defaultSessionId,
  iso,
  plural,
  recordWindow,
  validWindow,
} from './format.js';
import { resolveEntityRef } from './refs.js';

export interface ToolDeps {
  db: Sql;
  provider: Provider;
  namespaceId: string;
  clock: Clock;
  /**
   * engram_remember's default for `wait`. Local models take 5-15 s a turn, so
   * local mode returns at once and extracts in the background (P08b).
   */
  rememberWaitDefault: boolean;
  /** Receives work that outlives a tool call (`wait: false`); tests await it. */
  background: (task: Promise<void>) => void;
  /** Diagnostics. Never stdout: stdio carries the protocol there. */
  log: (message: string) => void;
}

const isoDate = z.iso
  .datetime({ offset: true })
  .describe('ISO 8601 date-time, e.g. 2024-06-10T09:00:00Z');
const toDate = (s: string | undefined) => (s === undefined ? undefined : new Date(s));

const OUTCOMES = [
  'inserted',
  'merged',
  'updated',
  'backfilled',
  'corrected',
  'coexisted',
  'rejected',
] as const;
const Outcomes = z.object(
  Object.fromEntries(OUTCOMES.map((k) => [k, z.number().int()])) as Record<
    (typeof OUTCOMES)[number],
    z.ZodNumber
  >,
);

const text = (t: string) => [{ type: 'text' as const, text: t }];
const failure = (message: string) => ({ content: text(message), isError: true });

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { db, provider, namespaceId, clock } = deps;

  server.registerTool(
    'engram_remember',
    {
      title: 'Remember',
      description:
        'Store something durable about the user in long-term memory. Call this whenever the user ' +
        'shares a lasting fact, preference, relationship, plan or decision (where they live or work, ' +
        "who people are, what they like or chose), or corrects one. Pass the user's own words where " +
        "possible. Don't store small talk or details that only matter to the current task." +
        (deps.rememberWaitDefault
          ? ''
          : ' Extraction runs in the background here, so a fact you just stored may take a few seconds to appear in engram_recall.'),
      inputSchema: z.object({
        content: z
          .string()
          .trim()
          .min(1)
          .max(8000)
          .describe('What the user said, ideally verbatim.'),
        session_id: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe('Groups related turns; defaults to one session per UTC day.'),
        occurred_at: isoDate
          .optional()
          .describe(
            'When it was said; defaults to now. Relative dates ("last May") resolve against it.',
          ),
        wait: z
          .boolean()
          .default(deps.rememberWaitDefault)
          .describe(
            deps.rememberWaitDefault
              ? 'Wait for extraction and return what was stored (default). false returns at once.'
              : 'false (default here): return at once and extract in the background. true waits for what was stored.',
          ),
      }),
      outputSchema: z.object({
        episode_id: z.string(),
        session_id: z.string(),
        status: z.enum([
          'processed',
          'already_processed',
          'skipped_tool',
          'skipped_summary',
          'pending',
        ]),
        importance: z.number().nullable(),
        extracted: z.number().int(),
        created_entities: z.number().int(),
        dropped: z.number().int(),
        outcomes: Outcomes,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ content, session_id, occurred_at, wait }) => {
      const sessionId = session_id ?? defaultSessionId(clock.now());
      const episode = await ingest(
        db,
        provider,
        {
          namespaceId,
          sessionId,
          role: 'user',
          content,
          occurredAt: toDate(occurred_at) ?? clock.now(),
        },
        { clock },
      );
      if (!wait) {
        deps.background(
          processEpisode(db, provider, episode.id, { clock }).then(
            () => undefined,
            (err: unknown) => {
              deps.log(`engram_remember: processing ${episode.id} failed: ${String(err)}`);
            },
          ),
        );
        return {
          content: text(
            `Stored episode ${episode.id} (session ${sessionId}); extracting facts in the background.`,
          ),
          structuredContent: {
            episode_id: episode.id,
            session_id: sessionId,
            status: 'pending' as const,
            importance: null,
            extracted: 0,
            created_entities: 0,
            dropped: 0,
            outcomes: Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Record<
              (typeof OUTCOMES)[number],
              number
            >,
          },
        };
      }
      const s = await processEpisode(db, provider, episode.id, { clock });
      const lines = [`Stored episode ${episode.id} (session ${sessionId}).`];
      if (s.status === 'processed') {
        lines.push(
          `Extracted ${plural(s.extracted, 'fact')}: ${counts(s.outcomes)}.` +
            (s.createdEntities > 0
              ? ` ${plural(s.createdEntities, 'new entity', 'new entities')}.`
              : ''),
        );
      } else {
        lines.push(`No extraction (${s.status.replace('_', ' ')}).`);
      }
      return {
        content: text(lines.join('\n')),
        structuredContent: {
          episode_id: episode.id,
          session_id: sessionId,
          status: s.status,
          importance: s.importance,
          extracted: s.extracted,
          created_entities: s.createdEntities,
          dropped: s.dropped,
          outcomes: s.outcomes,
        },
      };
    },
  );

  const Memory = z.object({
    id: z.string(),
    kind: z.enum(['fact', 'episode']),
    text: z.string(),
    status: z.string().nullable(),
    valid_from: z.string().nullable(),
    valid_to: z.string().nullable(),
    recorded_at: z.string(),
    invalidated_at: z.string().nullable(),
    source_episode_ids: z.array(z.string()),
    score: z.number(),
  });

  server.registerTool(
    'engram_recall',
    {
      title: 'Recall',
      description:
        "Search the user's long-term memory. Call this at the start of a task or conversation, and " +
        'whenever the user refers to something from before ("my brother", "the usual", "like last time"). ' +
        'Facts come with validity windows (when they were true) and record windows (when Engram knew them). ' +
        'Pass valid_at to ask what was true at a past time, and known_at to ask what Engram believed then.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(1000).describe('What to look for, in plain words.'),
        k: z.number().int().min(1).max(20).default(8).describe('How many memories to return.'),
        valid_at: isoDate.optional().describe('Return what was true at this time (default: now).'),
        known_at: isoDate
          .optional()
          .describe('Return what Engram believed at this time (default: now).'),
        include_archived: z
          .boolean()
          .default(false)
          .describe('Include facts archived by decay or by request.'),
      }),
      outputSchema: z.object({
        abstained: z.boolean(),
        memories: z.array(Memory),
        /** Episodes stored but not yet extracted (wait: false, or a restart); not yet recallable as facts. */
        pending: z.number().int(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, k, valid_at, known_at, include_archived }) => {
      const r = await recall(
        db,
        provider,
        {
          namespaceId,
          query,
          k,
          validAt: toDate(valid_at),
          knownAt: toDate(known_at),
          includeArchived: include_archived,
          // MCP tracks access for everything it returns (SPEC §6.2).
          trackAccess: true,
        },
        clock,
      );
      const [queue] = await db<{ n: number }[]>`
        select count(*)::int as n from episodes where namespace_id = ${namespaceId} and processed_at is null`;
      const pending = queue?.n ?? 0;
      const memories = r.memories.map((m) => ({
        id: m.id,
        kind: m.kind,
        text: m.text,
        status: m.status,
        valid_from: boundJson(m.validFrom),
        valid_to: boundJson(m.validTo),
        recorded_at: iso(m.recordedAt),
        invalidated_at: m.invalidatedAt ? iso(m.invalidatedAt) : null,
        source_episode_ids: m.sourceEpisodeIds,
        score: Math.round(m.score * 1e6) / 1e6,
      }));
      const lines = r.memories.map((m, i) =>
        m.kind === 'fact'
          ? `${i + 1}. [fact ${m.id}] ${m.text} (${validWindow(m.validFrom, m.validTo)}; ${recordWindow(m.recordedAt, m.invalidatedAt)}; ${m.status ?? 'active'}; ${plural(m.sourceEpisodeIds.length, 'source')})`
          : `${i + 1}. [episode ${m.id}] ${m.text} (said ${iso(m.validFrom)})`,
      );
      return {
        content: text(
          [
            lines.length > 0 ? lines.join('\n') : 'Nothing relevant in memory.',
            ...(pending > 0
              ? [
                  `(${plural(pending, 'recent memory is', 'recent memories are')} still being processed; ask again shortly.)`,
                ]
              : []),
          ].join('\n'),
        ),
        structuredContent: { abstained: r.abstained, memories, pending },
      };
    },
  );

  server.registerTool(
    'engram_history',
    {
      title: 'History',
      description:
        'Show how the facts about one entity changed over time: each version with when it was true ' +
        'and when Engram believed it. Call this when the user asks what used to be true, when ' +
        'something changed, or why Engram believes something, and before correcting a fact. ' +
        'entity is a name, an alias, an id from engram_entities, or "user" for the user.',
      inputSchema: z.object({
        entity: z.string().trim().min(1).max(200),
        predicate: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe('Only this relation, e.g. lives_in.'),
        include_revised: z
          .boolean()
          .default(false)
          .describe('Also show versions replaced by a newer one (the audit view).'),
      }),
      outputSchema: z.object({
        entity: z.object({ id: z.string(), name: z.string(), type: z.string().nullable() }),
        entries: z.array(
          z.object({
            fact_id: z.string(),
            predicate: z.string(),
            object: z.string(),
            statement: z.string(),
            status: z.string(),
            tier: z.string(),
            valid_from: z.string().nullable(),
            valid_to: z.string().nullable(),
            recorded_at: z.string(),
            invalidated_at: z.string().nullable(),
            replaced: z.boolean(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ entity, predicate, include_revised }) => {
      const ref = await resolveEntityRef(db, namespaceId, entity);
      if ('error' in ref) return failure(ref.error);
      const e = ref.entity;
      const entries = await history(db, namespaceId, e.id, {
        predicate: predicate === undefined ? undefined : normalizePredicate(predicate).predicate,
        includeRevised: include_revised,
      });
      const name = e.isSelf ? 'the user' : e.name;
      const lines = entries.map(
        (h) =>
          `- ${h.fact.predicate} ${h.objectName}: ${validWindow(h.fact.validFrom, h.fact.validTo)}; ` +
          `${recordWindow(h.fact.recordedAt, h.fact.invalidatedAt)}; ${h.fact.status}` +
          `${h.replaced ? ', replaced' : ''} [fact ${h.fact.id}]`,
      );
      return {
        content: text(
          lines.length > 0
            ? [`History of ${name}:`, ...lines].join('\n')
            : `No facts about ${name}${predicate ? ` for ${predicate}` : ''}.`,
        ),
        structuredContent: {
          entity: { id: e.id, name: e.name, type: e.type },
          entries: entries.map((h) => ({
            fact_id: h.fact.id,
            predicate: h.fact.predicate,
            object: h.objectName,
            statement: h.fact.statement,
            status: h.fact.status,
            tier: h.fact.tier,
            valid_from: boundJson(h.fact.validFrom),
            valid_to: boundJson(h.fact.validTo),
            recorded_at: iso(h.fact.recordedAt),
            invalidated_at: h.fact.invalidatedAt ? iso(h.fact.invalidatedAt) : null,
            replaced: h.replaced,
          })),
        },
      };
    },
  );

  server.registerTool(
    'engram_entities',
    {
      title: 'Find entities',
      description:
        'Find the people, places, organizations and things Engram knows about, by name, alias or ' +
        'description. Call this to work out who or what a name refers to (two people can share a ' +
        'name), or to get an entity id for engram_history or engram_forget.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      outputSchema: z.object({
        entities: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            type: z.string().nullable(),
            aliases: z.array(z.string()),
            description: z.string().nullable(),
            match: z.enum(['name', 'alias', 'similar']),
            similarity: z.number().nullable(),
            facts: z.number().int(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const hits = await searchEntities(db, provider, { namespaceId, query, limit });
      const lines = hits.map(
        (h) =>
          `- ${h.entity.name} (${h.entity.type ?? 'unknown'})` +
          (h.entity.description ? `: ${h.entity.description}` : '') +
          (h.entity.aliases.length > 0 ? `; aliases ${h.entity.aliases.join(', ')}` : '') +
          `; ${plural(h.facts, 'fact')} [entity ${h.entity.id}]`,
      );
      return {
        content: text(lines.length > 0 ? lines.join('\n') : `No entities match "${query}".`),
        structuredContent: {
          entities: hits.map((h) => ({
            id: h.entity.id,
            name: h.entity.name,
            type: h.entity.type,
            aliases: h.entity.aliases,
            description: h.entity.description,
            match: h.match,
            similarity: h.similarity === null ? null : Math.round(h.similarity * 1e6) / 1e6,
            facts: h.facts,
          })),
        },
      };
    },
  );

  server.registerTool(
    'engram_forget',
    {
      title: 'Forget',
      description:
        'Forget facts. Call this only when the user asks you to forget something, or says a stored ' +
        'fact is wrong. Target one fact (fact_id from engram_recall or engram_history), or an entity ' +
        'with an optional predicate. mode "archive" hides it from recall and can be undone; "retract" ' +
        'records that the belief was wrong; "hard" erases every trace and cannot be undone. Pass ' +
        'confirm_hard: true only after the user has explicitly confirmed a hard purge.',
      inputSchema: z.object({
        fact_id: z.uuid().optional(),
        entity: z.string().trim().min(1).max(200).optional(),
        predicate: z.string().trim().min(1).max(100).optional(),
        mode: z.enum(['archive', 'retract', 'hard']),
        confirm_hard: z.boolean().default(false),
        reason: z.string().trim().min(1).max(500).optional(),
      }),
      outputSchema: z.object({
        mode: z.enum(['archive', 'retract', 'hard']),
        fact_ids: z.array(z.string()),
        purge: z
          .object({
            facts: z.number().int(),
            revisions: z.number().int(),
            episodes_deleted: z.number().int(),
            episodes_redacted: z.number().int(),
            summaries_deleted: z.number().int(),
            entities_deleted: z.number().int(),
          })
          .nullable(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ fact_id, entity, predicate, mode, confirm_hard, reason }) => {
      if ((fact_id === undefined) === (entity === undefined)) {
        return failure('Give exactly one target: fact_id, or entity (with an optional predicate).');
      }
      if (fact_id !== undefined && predicate !== undefined) {
        return failure('predicate only applies with entity, not with fact_id.');
      }
      if (mode === 'hard' && !confirm_hard) {
        return failure(
          'A hard purge erases every trace and cannot be undone. Confirm with the user, then call again with confirm_hard: true.',
        );
      }
      let entityId: string | undefined;
      if (entity !== undefined) {
        const ref = await resolveEntityRef(db, namespaceId, entity);
        if ('error' in ref) return failure(ref.error);
        entityId = ref.entity.id;
      }
      try {
        const r = await forget(
          db,
          {
            namespaceId,
            factId: fact_id,
            entityId,
            predicate:
              predicate === undefined ? undefined : normalizePredicate(predicate).predicate,
            mode,
            confirmHard: confirm_hard,
            reason,
          },
          clock,
        );
        const p = r.purge;
        const summary =
          mode === 'archive'
            ? `Archived ${plural(r.factIds.length, 'fact')}; engram_recall hides them unless include_archived is set.`
            : mode === 'retract'
              ? `Retracted ${plural(r.factIds.length, 'fact')}; they no longer count as beliefs.`
              : `Purged ${plural(p?.facts ?? 0, 'fact version')}, ${plural(p?.revisions ?? 0, 'revision')}; ` +
                `deleted ${plural(p?.episodesDeleted ?? 0, 'episode')}, redacted ${p?.episodesRedacted ?? 0}, ` +
                `deleted ${plural(p?.summariesDeleted ?? 0, 'summary', 'summaries')} and ` +
                `${plural(p?.entitiesDeleted ?? 0, 'orphaned entity', 'orphaned entities')}.`;
        return {
          content: text(`${summary}\n${r.factIds.map((id) => `- fact ${id}`).join('\n')}`),
          structuredContent: {
            mode: r.mode,
            fact_ids: r.factIds,
            purge: p
              ? {
                  facts: p.facts,
                  revisions: p.revisions,
                  episodes_deleted: p.episodesDeleted,
                  episodes_redacted: p.episodesRedacted,
                  summaries_deleted: p.summariesDeleted,
                  entities_deleted: p.entitiesDeleted,
                }
              : null,
          },
        };
      } catch (err) {
        if (err instanceof ForgetError) return failure(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    'engram_consolidate',
    {
      title: 'Consolidate',
      description:
        'Consolidate recent conversation into long-term memory now: summarize recent sessions and ' +
        'confirm their facts. It normally runs nightly; call this only when the user asks, or at the ' +
        'end of a long session whose facts should be durable straight away.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        pending_processed: z.number().int(),
        pending_remaining: z.number().int(),
        summarized: z.number().int(),
        skipped: z.number().int(),
        remaining: z.number().int(),
        blocked: z.number().int(),
        failed: z.number().int(),
        candidates: z.number().int(),
        promoted: z.number().int(),
        outcomes: Outcomes,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      // Consolidation clusters only processed turns, so finish any stragglers first.
      const pending = await processPending(db, provider, { namespaceId, clock });
      if (pending.error)
        deps.log(`engram_consolidate: pending processing stopped: ${pending.error}`);
      const r = await consolidate(db, provider, { namespaceId, clock });
      const lines = [
        `Summarized ${plural(r.summarized, 'cluster')}, skipped ${r.skipped} as small talk` +
          (r.remaining > 0 ? `, ${r.remaining} left for the next run` : '') +
          (r.blocked > 0 ? `; the model refused ${plural(r.blocked, 'cluster')}` : '') +
          `${r.failed > 0 ? `; ${plural(r.failed, 'cluster')} failed and will be retried` : ''}.`,
        `${plural(r.candidates, 'candidate')} (${counts(r.outcomes)}); ${plural(r.promoted, 'fact')} promoted to long-term.`,
      ];
      if (pending.processed > 0 || pending.remaining > 0) {
        lines.unshift(
          `Processed ${plural(pending.processed, 'pending episode')} first` +
            `${pending.remaining > 0 ? ` (${pending.remaining} still pending)` : ''}.`,
        );
      }
      return {
        content: text(lines.join('\n')),
        structuredContent: {
          pending_processed: pending.processed,
          pending_remaining: pending.remaining,
          summarized: r.summarized,
          skipped: r.skipped,
          remaining: r.remaining,
          blocked: r.blocked,
          failed: r.failed,
          candidates: r.candidates,
          promoted: r.promoted,
          outcomes: r.outcomes,
        },
      };
    },
  );
}
