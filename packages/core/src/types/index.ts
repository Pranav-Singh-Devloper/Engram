// Domain types mirroring the schema in supabase/migrations/0002_core_schema.sql.
// The value lists are the single source for zod enums and CHECK constraints.

export const NAMESPACE_KINDS = ['user', 'demo', 'bench'] as const;
export type NamespaceKind = (typeof NAMESPACE_KINDS)[number];

export const EPISODE_KINDS = ['turn', 'summary'] as const;
export type EpisodeKind = (typeof EPISODE_KINDS)[number];

export const EPISODE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type EpisodeRole = (typeof EPISODE_ROLES)[number];

export const ENTITY_TYPES = ['person', 'place', 'org', 'thing', 'concept'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Denormalized UI label; queries filter on time columns, never on this (SPEC §5.1). */
export const FACT_STATUSES = ['active', 'superseded', 'retracted', 'revised'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const FACT_TIERS = ['working', 'long_term', 'archived'] as const;
export type FactTier = (typeof FACT_TIERS)[number];

/** `unknown` means valid_from is UNKNOWN_START (-infinity in the database). */
export const VALID_FROM_SOURCES = ['explicit', 'episode', 'unknown'] as const;
export type ValidFromSource = (typeof VALID_FROM_SOURCES)[number];

export const REVISION_KINDS = [
  'update',
  'correction',
  'backfill',
  'merge',
  'coexist',
  'reject',
  'retraction',
  'archive',
  'restore',
] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

export const RESOLVERS = ['rule', 'llm', 'manual', 'decay'] as const;
export type Resolver = (typeof RESOLVERS)[number];

export interface Namespace {
  id: string;
  slug: string;
  kind: NamespaceKind;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface Episode {
  id: string;
  namespaceId: string;
  sessionId: string;
  kind: EpisodeKind;
  role: EpisodeRole;
  content: string;
  embedding: number[] | null;
  importance: number;
  occurredAt: Date;
  processedAt: Date | null;
  consolidated: boolean;
  summarizes: string[];
  createdAt: Date;
}

export interface Entity {
  id: string;
  namespaceId: string;
  name: string;
  type: EntityType | null;
  aliases: string[];
  description: string | null;
  isSelf: boolean;
  embedding: number[] | null;
  createdAt: Date;
}

export interface Fact {
  id: string;
  namespaceId: string;
  subjectId: string;
  predicate: string;
  predicateAdHoc: boolean;
  objectId: string | null;
  objectLiteral: string | null;
  statement: string;
  embedding: number[] | null;
  confidence: number;
  importance: number;
  pinned: boolean;
  accessScore: number;
  lastAccessedAt: Date | null;
  validFrom: Date;
  validFromSource: ValidFromSource;
  validTo: Date | null;
  recordedAt: Date;
  invalidatedAt: Date | null;
  revises: string | null;
  supersededBy: string | null;
  status: FactStatus;
  tier: FactTier;
  sourceEpisodeIds: string[];
  createdAt: Date;
}

export interface FactRevision {
  id: string;
  namespaceId: string;
  oldFactId: string | null;
  newFactId: string | null;
  kind: RevisionKind;
  resolver: Resolver;
  candidate: unknown;
  reason: string | null;
  createdAt: Date;
}
