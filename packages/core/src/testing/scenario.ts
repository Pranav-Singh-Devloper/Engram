// A small driver for bitemporal scenarios, shared by the §7.4 suite, the
// history tests and `pnpm demo:offline`. Each turn is scripted on a
// FakeProvider, ingested at its historical time and processed with a
// simulated clock, so record time is exact.
import { SimClock } from '../config/clock.js';
import type { Sql } from '../db/client.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import { ingest } from '../ingest/ingest.js';
import { processEpisode } from '../ingest/process.js';
import type { ProcessSummary } from '../ingest/process.js';
import { SELF_REF } from '../providers/contracts.js';
import type { EntityRef, FactCandidate, TemporalHint } from '../providers/contracts.js';
import { FakeProvider } from '../providers/fake.js';
import { factsAsOf } from '../temporal/asOf.js';
import type { EntityType } from '../types/index.js';

export const hint = {
  none: { kind: 'none' } as TemporalHint,
  date: (date: string): TemporalHint => ({ kind: 'absolute', date }),
  year: (year: number): TemporalHint => ({ kind: 'named_period', year, month: null, season: null }),
  month: (month: number, year: number | null = null): TemporalHint => ({
    kind: 'named_period',
    year,
    month,
    season: null,
  }),
  ago: (amount: number, unit: 'day' | 'week' | 'month' | 'year'): TemporalHint => ({
    kind: 'relative',
    amount,
    unit,
    direction: 'ago',
  }),
};

const SELF: EntityRef = { name: SELF_REF, type: 'person', description: null };

/** A candidate about the user. `object` is an entity name unless `literal` is set. */
export function aboutSelf(
  predicate: string,
  object: string,
  options: {
    type?: EntityType;
    literal?: boolean;
    statement?: string;
    from?: TemporalHint;
    to?: TemporalHint;
    correction?: boolean;
    confidence?: number;
    subject?: EntityRef;
  } = {},
): FactCandidate {
  return {
    subject: options.subject ?? SELF,
    predicate,
    object: options.literal
      ? { kind: 'literal', value: object }
      : {
          kind: 'entity',
          entity: { name: object, type: options.type ?? 'place', description: null },
        },
    statement: options.statement ?? `The user ${predicate.replace(/_/g, ' ')} ${object}.`,
    validFrom: options.from ?? hint.none,
    validTo: options.to ?? hint.none,
    isCorrection: options.correction ?? false,
    confidence: options.confidence ?? 0.9,
  };
}

export interface Turn {
  /** When it was said: the episode's occurred_at and, unless `learnedAt` is set, its record time. */
  at: string;
  learnedAt?: string;
  content: string;
  candidates: FactCandidate[];
  importance?: number;
}

export interface TurnResult {
  summary: ProcessSummary;
  /** fact_revisions rows the turn wrote. */
  revisions: number;
}

interface RowState {
  content: string;
  invalidatedAt: string | null;
}

export class Scenario {
  readonly fake = new FakeProvider();
  readonly clock: SimClock;
  private seen = new Map<string, RowState>();

  constructor(
    readonly db: Sql,
    readonly ns: NamespaceWithSelf,
    start = '2024-01-01T00:00:00Z',
  ) {
    this.clock = new SimClock(start);
  }

  async tell(turn: Turn): Promise<TurnResult> {
    this.fake.when('processEpisode', (input) => input.content === turn.content, {
      importance: turn.importance ?? 0.5,
      candidates: turn.candidates,
    });
    const before = await this.revisionCount();
    const episode = await ingest(this.db, this.fake, {
      namespaceId: this.ns.namespace.id,
      sessionId: 's1',
      role: 'user',
      content: turn.content,
      occurredAt: new Date(turn.at),
    });
    this.clock.set(turn.learnedAt ?? turn.at);
    const summary = await processEpisode(this.db, this.fake, episode.id, { clock: this.clock });
    return { summary, revisions: (await this.revisionCount()) - before };
  }

  /** Object labels for (subject, predicate) believed at `knownAt` to hold at `validAt`. */
  async values(
    predicate: string,
    asOf: { validAt?: string | Date; knownAt?: string | Date } = {},
    subjectId = this.ns.selfEntity.id,
  ): Promise<string[]> {
    const facts = await factsAsOf(
      this.db,
      {
        namespaceId: this.ns.namespace.id,
        subjectId,
        predicate,
        validAt: asOf.validAt === undefined ? undefined : new Date(asOf.validAt),
        knownAt: asOf.knownAt === undefined ? undefined : new Date(asOf.knownAt),
      },
      this.clock,
    );
    if (facts.length === 0) return [];
    const names = await this.db<{ id: string; name: string }[]>`
      select id, name from entities where id = any(${this.db.array(facts.flatMap((f) => (f.objectId ? [f.objectId] : [])))}::uuid[])`;
    const byId = new Map(names.map((n) => [n.id, n.name]));
    return facts
      .map((f) => (f.objectId ? (byId.get(f.objectId) ?? '?') : (f.objectLiteral ?? '?')))
      .sort();
  }

  private async revisionCount(): Promise<number> {
    const [row] = await this.db<{ n: number }[]>`
      select count(*)::int as n from fact_revisions where namespace_id = ${this.ns.namespace.id}`;
    return row?.n ?? 0;
  }

  /**
   * SPEC §5.1 invariants, as a list of violations (empty when all hold):
   * rows never change content once written (only the documented columns
   * move); each status agrees with the time columns; a revision's record
   * time equals its original's invalidation time.
   */
  async checkInvariants(): Promise<string[]> {
    const rows = await this.db<
      {
        id: string;
        content: string;
        status: string;
        validTo: Date | null;
        invalidatedAt: Date | null;
        recordedAt: Date;
        revises: string | null;
        replaced: boolean;
        originalInvalidatedAt: Date | null;
      }[]
    >`
      select f.id, f.status, f.valid_to, f.invalidated_at, f.recorded_at, f.revises,
             md5(concat_ws('|', f.subject_id, f.predicate, f.object_id, f.object_literal, f.statement,
                 f.confidence, f.importance, f.valid_from, f.valid_from_source, f.valid_to,
                 f.recorded_at, f.revises, array_to_string(f.source_episode_ids, ','))) as content,
             exists (select 1 from facts n where n.revises = f.id) as replaced,
             o.invalidated_at as original_invalidated_at
      from facts f left join facts o on o.id = f.revises
      where f.namespace_id = ${this.ns.namespace.id}`;

    const problems: string[] = [];
    for (const r of rows) {
      const prior = this.seen.get(r.id);
      if (prior && prior.content !== r.content)
        problems.push(`${r.id}: content changed after insert`);
      if (
        prior?.invalidatedAt &&
        prior.invalidatedAt !== (r.invalidatedAt?.toISOString() ?? null)
      ) {
        problems.push(`${r.id}: invalidated_at changed after being set`);
      }
      this.seen.set(r.id, {
        content: r.content,
        invalidatedAt: r.invalidatedAt?.toISOString() ?? null,
      });

      const expected =
        r.invalidatedAt === null
          ? r.validTo === null
            ? 'active'
            : 'superseded'
          : r.replaced
            ? 'revised'
            : 'retracted';
      if (r.status !== expected)
        problems.push(`${r.id}: status ${r.status}, time columns say ${expected}`);
      if (r.revises && r.originalInvalidatedAt?.getTime() !== r.recordedAt.getTime()) {
        problems.push(`${r.id}: recorded_at doesn't meet its original's invalidated_at`);
      }
    }
    return problems;
  }
}
