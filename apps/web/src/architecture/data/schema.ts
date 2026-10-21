// The `engram` schema as Postgres reports it (bench explorer:data reads the
// catalog after every migration), plus what each table is for and where it
// sits in the diagram. schema.test.ts fails when a migration adds a table
// that has neither.
import raw from '@/content/generated/schema.json';

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface Constraint {
  name: string;
  kind: 'primary' | 'foreign' | 'unique' | 'check';
  definition: string;
  references: string | null;
}

export interface Table {
  name: string;
  columns: Column[];
  constraints: Constraint[];
  indexes: { name: string; definition: string }[];
}

export const SCHEMA = raw as {
  migrations: string[];
  functions: { name: string; args: string }[];
  tables: Table[];
};

export const TABLE_INFO: Record<string, { about: string; x: number; y: number }> = {
  namespaces: {
    about:
      'One memory per user, agent or demo visitor. Every other row hangs off a namespace and is deleted with it (on delete cascade). Records the embedding space the namespace is bound to (ADR-017).',
    x: 0,
    y: 230,
  },
  episodes: {
    about:
      'What was said, when: every turn, and the summaries consolidation writes (kind = summary). Never edited except to mark processed or consolidated.',
    x: 330,
    y: 0,
  },
  entities: {
    about:
      'Canonical people, places, organizations and things, with aliases and an embedding for the resolution ladder. Exactly one is_self entity per namespace (a partial unique index).',
    x: 330,
    y: 380,
  },
  facts: {
    about:
      'Immutable fact versions with both time axes. A change writes new rows and closes old beliefs; revises and superseded_by chain the versions together (§7.2).',
    x: 660,
    y: 0,
  },
  fact_revisions: {
    about:
      'The audit log of every belief change: update, correction, backfill, merge, archive, retraction. Who decided (rule, llm, manual, decay) and why.',
    x: 990,
    y: 0,
  },
  decay_sweeps: {
    about:
      'When the nightly sweep last covered each namespace, so access scores decay by the real gap between sweeps.',
    x: 990,
    y: 300,
  },
  rate_limits: {
    about: 'Turns per namespace per hour, for the public demo (P09a).',
    x: 990,
    y: 470,
  },
  throttles: {
    about:
      'Per-IP and global counters for the public demo, keyed by an HMAC of day and IP, never the raw address (ADR-019). Pruned by the nightly job.',
    x: 0,
    y: 520,
  },
  schema_migrations: {
    about:
      'Which migration files have been applied, with a checksum, so a migration can never be silently edited.',
    x: 0,
    y: 700,
  },
};

/** What a kind of index buys (shown next to each one). */
export function indexKind(definition: string): { label: string; why: string } {
  if (/USING hnsw/.test(definition))
    return { label: 'HNSW', why: 'approximate nearest neighbours over 768-d cosine' };
  if (/USING gin/.test(definition))
    return { label: 'GIN full text', why: 'English tsvector, for the full-text candidate list' };
  if (/ WHERE /.test(definition))
    return { label: 'partial', why: 'indexes only the rows that predicate selects' };
  if (/UNIQUE/.test(definition)) return { label: 'unique', why: 'enforced by Postgres' };
  return { label: 'b-tree', why: 'lookups and ordering' };
}

/** Foreign-key columns of a constraint definition: "FOREIGN KEY (a, b) REFERENCES …" → [a, b]. */
export const fkColumns = (definition: string) =>
  /FOREIGN KEY \(([^)]+)\)/
    .exec(definition)?.[1]
    ?.split(',')
    .map((s) => s.trim()) ?? [];
