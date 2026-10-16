-- Core schema (SPEC §5). Embeddings are 768-dim; changing that is a new
-- migration plus an ADR. Relations to `facts` don't cascade: fact rows are
-- immutable versions, and a hard purge deletes them in an explicit order
-- (SPEC §9.3). Deleting a namespace still removes everything in it, because
-- every table cascades from `namespaces`.

-- Isolation boundary: one per user/client config, per bench item, per demo visitor.
create table engram.namespaces (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  kind        text not null default 'user' check (kind in ('user', 'demo', 'bench')),
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Episodic memory: raw turns and consolidation summaries.
create table engram.episodes (
  id            uuid primary key default gen_random_uuid(),
  namespace_id  uuid not null references engram.namespaces(id) on delete cascade,
  session_id    text not null,
  kind          text not null default 'turn' check (kind in ('turn', 'summary')),
  role          text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content       text not null,
  embedding     vector(768),
  importance    real not null default 0.5 check (importance between 0 and 1),
  occurred_at   timestamptz not null default now(),
  processed_at  timestamptz,
  consolidated  boolean not null default false,
  summarizes    uuid[] not null default '{}',
  created_at    timestamptz not null default now()
);

-- Canonical entities.
create table engram.entities (
  id            uuid primary key default gen_random_uuid(),
  namespace_id  uuid not null references engram.namespaces(id) on delete cascade,
  name          text not null,
  type          text check (type in ('person', 'place', 'org', 'thing', 'concept')),
  aliases       text[] not null default '{}',
  description   text,
  is_self       boolean not null default false,
  embedding     vector(768),
  created_at    timestamptz not null default now()
);
create unique index entities_one_self on engram.entities (namespace_id) where is_self;

-- Semantic memory: immutable fact versions with bitemporal validity (SPEC §5.1).
create table engram.facts (
  id                 uuid primary key default gen_random_uuid(),
  namespace_id       uuid not null references engram.namespaces(id) on delete cascade,
  subject_id         uuid not null references engram.entities(id),
  predicate          text not null,
  predicate_ad_hoc   boolean not null default false,
  object_id          uuid references engram.entities(id),
  object_literal     text,
  statement          text not null,
  embedding          vector(768),
  confidence         real not null default 0.8 check (confidence between 0 and 1),
  importance         real not null default 0.5 check (importance between 0 and 1),
  pinned             boolean not null default false,
  access_score       real not null default 0 check (access_score >= 0),
  last_accessed_at   timestamptz,
  -- valid time: when the fact was true in the world
  valid_from         timestamptz not null,
  valid_from_source  text not null default 'episode'
                     check (valid_from_source in ('explicit', 'episode')),
  valid_to           timestamptz,
  -- record time: when the system held this belief
  recorded_at        timestamptz not null default now(),
  invalidated_at     timestamptz,
  -- lineage
  revises            uuid references engram.facts(id),
  superseded_by      uuid references engram.facts(id),
  status             text not null default 'active'
                     check (status in ('active', 'superseded', 'retracted', 'revised')),
  tier               text not null default 'working'
                     check (tier in ('working', 'long_term', 'archived')),
  source_episode_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  check ((object_id is null) <> (object_literal is null)),
  check (valid_to is null or valid_to > valid_from),
  check (invalidated_at is null or invalidated_at >= recorded_at)
);

-- Audit trail of every resolution decision.
create table engram.fact_revisions (
  id            uuid primary key default gen_random_uuid(),
  namespace_id  uuid not null references engram.namespaces(id) on delete cascade,
  old_fact_id   uuid references engram.facts(id),
  new_fact_id   uuid references engram.facts(id),
  kind          text not null check (kind in (
                  'update', 'correction', 'backfill', 'merge', 'coexist', 'reject',
                  'retraction', 'archive', 'restore')),
  resolver      text not null check (resolver in ('rule', 'llm', 'manual', 'decay')),
  candidate     jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);

-- Per-namespace rate limiting for the public demo.
create table engram.rate_limits (
  namespace_id  uuid not null references engram.namespaces(id) on delete cascade,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (namespace_id, window_start)
);

-- Vector search (cosine distance; vectors are L2-normalized).
create index episodes_embedding_hnsw on engram.episodes using hnsw (embedding vector_cosine_ops);
create index entities_embedding_hnsw on engram.entities using hnsw (embedding vector_cosine_ops);
create index facts_embedding_hnsw on engram.facts using hnsw (embedding vector_cosine_ops);

-- Full-text search. Queries must use the same expression to hit these.
create index episodes_content_fts on engram.episodes using gin (to_tsvector('english', content));
create index facts_statement_fts on engram.facts using gin (to_tsvector('english', statement));

-- Current beliefs per (subject, predicate): conflict resolution's lookup.
create index facts_current_subject_predicate on engram.facts (namespace_id, subject_id, predicate)
  where invalidated_at is null;
create index facts_namespace_tier on engram.facts (namespace_id, tier);
create index episodes_namespace_session_time on engram.episodes (namespace_id, session_id, occurred_at);
create index entities_namespace_name on engram.entities (namespace_id, lower(name));
