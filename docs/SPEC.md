# Engram — Build Specification

**One-liner:** A persistent memory engine for AI agents — episodic + semantic memory with consolidation, decay, conflict resolution, and bitemporal validity — exposed over MCP, measured against strong baselines and an external benchmark, and inspectable through a web dashboard.

**Elevator pitch:** Agents forget everything between sessions, and stapling chat history into the prompt doesn't scale. Engram is a memory layer that extracts facts from conversations, links them into an entity graph, resolves contradictions when facts change ("Sam moved from Paris to Berlin"), and tracks two kinds of time: when each fact was true in the world, and when the system believed it. It can answer both "where did Sam live last March?" and "what did you *know* about Sam last March?" It forgets gracefully instead of growing forever, works with any MCP-capable client (Claude Code, Claude Desktop, Cursor, custom agents), and its recall quality is measured against a full-context baseline and an external benchmark, not asserted.

---

## 1. Goals and non-goals

**Goals**
1. Real long-term memory: episodic (what happened) + semantic (what is true), persisted in Postgres, surviving across sessions and clients.
2. The hard parts done properly: consolidation, decay/forgetting, conflict resolution (including out-of-order information), and true bitemporal queries (valid time *and* record time).
3. MCP-first: usable from any MCP client through a handful of well-designed tools.
4. Credible measurement: a held-out test set with per-category accuracy, compared against buffer, naive RAG, and full-context baselines, plus an external number on a LongMemEval subset.
5. A web dashboard that makes the invisible visible: chat playground demonstrating cross-session recall, memory inspector, entity timelines, and eval results.

**Non-goals (v1)**
- Multi-tenant SaaS, orgs/teams, billing. (Namespaces exist for isolation, not as an auth model.)
- Auth beyond a bearer token for write/MCP endpoints and anonymous, rate-limited demo namespaces.
- Fine-tuning or training anything.
- Perfect NLP — extraction uses an LLM with validation; extraction error rates are measured and reported, not hidden.

---

## 2. Architecture decision

**Chosen path: a single-language TypeScript monorepo with a hand-built memory engine on Postgres (pgvector + relational graph tables with bitemporal columns).**

Rationale:
- The project exists to demonstrate the internals — conflict resolution, decay, consolidation, temporal queries. Delegating the temporal graph to Graphiti would outsource exactly those parts and add a Python runtime plus a graph database.
- One database engine (Postgres + pgvector: a plain Docker container locally and in CI, Neon free tier when hosted; ADR-014) and one web deploy target (Vercel) keep the free-stack story clean and the quickstart under 10 minutes.
- **Everything runs on free tiers or free trials.** No paid service is required at any point; every quota decision is made against free limits.
- TypeScript end-to-end: engine, MCP server (official TS SDK), Next.js app, and bench share types.

Graphiti, Mem0, Letta, and Cognee are **prior art** (Appendix C); Graphiti remains a documented alternative backend (Appendix B).

---

## 3. System overview

```
                       ┌─────────────────────────────┐
   MCP clients         │        apps/web (Next.js)   │
 (Claude Code,         │  chat · inspector ·         │
  Claude Desktop,      │  timelines · evals          │
  Cursor, agents)      └──────────────┬──────────────┘
        │                             │ HTTP (route handlers)
        ▼                             ▼
┌───────────────────┐        ┌─────────────────────┐
│  packages/mcp     │───────▶│   packages/core      │  the engine
│  stdio + HTTP     │        │  write path │ read   │
└───────────────────┘        └──────────┬──────────┘
                                        │ SQL
┌───────────────────┐        ┌──────────▼──────────┐
│ GitHub Actions    │───────▶│ Neon Postgres       │
│ nightly: decay,   │  SQL   │ pgvector · FTS ·    │
│ cleanup, consol.  │        │ scale to zero       │
└───────────────────┘        └─────────────────────┘
        LLM + embeddings via provider adapter (Gemini free tier default)
```

Components:
- **packages/core** — the memory engine: schema access, extraction, entity resolution, conflict resolution, retrieval, consolidation, decay. Pure library, unit-tested with a deterministic fake provider.
- **packages/mcp** — MCP server wrapping core. stdio transport for local clients; streamable HTTP transport mounted in the Next.js app.
- **apps/web** — Next.js dashboard, chat playground, HTTP API.
- **bench** — dataset generator, frozen dev/test splits, runner, LongMemEval adapter, reports ("Engram-Bench").
- **sql/** — `migrations/`: portable SQL (schema, SQL functions for decay and cleanup) applied to every database, local or hosted. `hosted/`: hosted-only SQL (the database-level search path; Supabase role revokes where those roles exist) applied only by the deploy step. (Named `supabase/` until ADR-014.)

Long-running work never runs inside Vercel functions. Decay and demo cleanup are SQL functions, and consolidation needs an LLM; all three run from the nightly GitHub Actions workflow against the hosted database. The free Neon compute scales to zero, so pg_cron there would fire only while something else kept it awake (ADR-014).

**Database targets.**
- *Local dev, tests, CI:* the plain `pgvector/pgvector` Docker image via `docker-compose.yml` (CI uses the same image as a service container). Decay tests call the SQL function directly with a simulated clock.
- *Hosted:* Neon free tier (ADR-014): Postgres 18 with pgvector, 1 GB storage, 100 CU-hours a month, scale to zero after 5 idle minutes. `HOSTED_DATABASE_URL` is the direct endpoint, for migrations, jobs and (by default) Vercel. Neon's pooled endpoint (PgBouncer) resets every session to its own search path, so the app can't use it unless queries set the path per transaction (verified 2026-10-17). `pnpm db:migrate` applies `sql/migrations/` to either target; `pnpm db:migrate:hosted` additionally applies `sql/hosted/`. The local runner never reads `sql/hosted/`.
- *Search path:* Neon's proxy drops the `search_path` startup parameter, so each migration sets it in its own transaction, and `sql/hosted/` sets it as the database default, which direct sessions honor. Pooled sessions don't.
- *Repeatable files:* a file named `R__*.sql` is re-applied whenever its content changes, after the numbered files; numbered files are immutable once applied, comments included.

---

## 4. Repository layout

```
engram/
├── DECISIONS.md              # short ADRs, append-only
├── README.md
├── docker-compose.yml        # local pgvector database
├── docs/
│   ├── SPEC.md               # this file
│   ├── phases/               # one plan per phase, expanded at phase start
│   ├── architecture.md       # written in Phase 10
│   └── demo.md               # scripted demo, Phase 9
├── packages/
│   ├── core/                 # engine (no HTTP, no CLI)
│   │   └── src/{db,extract,resolve,conflict,retrieve,consolidate,decay,purge,providers,types,config}/
│   └── mcp/                  # MCP server: server factory, tools, stdio entry, HTTP handler
├── apps/
│   └── web/                  # Next.js (App Router)
├── bench/
│   ├── dataset/              # generator, dev.json, test.json (frozen)
│   ├── longmemeval/          # adapter for the external subset
│   ├── runner/
│   ├── cache/                # LLM response cache (gitignored)
│   └── reports/
├── scripts/                  # migration runner, seed, demo-offline
├── sql/
│   ├── migrations/           # portable SQL, applied everywhere
│   └── hosted/               # hosted-only SQL (search path, revokes)
└── .github/workflows/        # ci.yml, bench.yml, nightly.yml
```

`CLAUDE.md` and `.claude/` are local agent files and are gitignored (see §16).

Tooling: pnpm workspaces, TypeScript strict, vitest, eslint + prettier, zod for all LLM I/O validation. No extra monorepo orchestrator unless it becomes necessary (ADR if so).

---

## 5. Data model (Postgres)

Embedding dimension: 768. Verify the current Gemini embedding model at build time. If it natively outputs more dimensions and you request 768 via truncation, L2-normalize vectors before storing. pgvector's HNSW index on the `vector` type supports at most 2,000 dimensions; anything larger needs `halfvec`. Changing dimension is a migration plus an ADR.

**Schemas.** All Engram tables and functions live in a dedicated `engram` schema; extensions live in an `extensions` schema. Both targets use the same layout, and connections set `search_path = engram, extensions`. The DDL below omits the `engram.` prefix for readability.

**Hosted exposure.** Neon serves no REST API unless its Data API is switched on; keep it off. Supabase, the earlier host, serves `public` over REST with a public anon key. For either, keeping everything in `engram` (not an API-exposed schema) means a REST API can't reach stored memories, and `sql/hosted/` revokes `engram` privileges from `anon` and `authenticated` wherever those roles exist, and function execution from `public` everywhere. The app connects only through `DATABASE_URL`, so neither measure affects application code.

```sql
create schema if not exists extensions;
create schema if not exists engram;
create extension if not exists vector with schema extensions;

-- Isolation boundary: one per user/client config, per bench item, per demo visitor
create table namespaces (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  kind        text not null default 'user' check (kind in ('user','demo','bench')),
  expires_at  timestamptz,                         -- demo namespaces only
  created_at  timestamptz not null default now()
);

-- Episodic memory: raw turns and consolidation summaries
create table episodes (
  id            uuid primary key default gen_random_uuid(),
  namespace_id  uuid not null references namespaces(id) on delete cascade,
  session_id    text not null,
  kind          text not null default 'turn' check (kind in ('turn','summary')),
  role          text not null check (role in ('user','assistant','system','tool')),
  content       text not null,
  embedding     vector(768),
  importance    real not null default 0.5,         -- LLM-scored during processing, 0..1
  occurred_at   timestamptz not null default now(),
  processed_at  timestamptz,                       -- extraction finished
  consolidated  boolean not null default false,
  summarizes    uuid[] not null default '{}',      -- kind='summary': source episode ids
  created_at    timestamptz not null default now()
);

-- Canonical entities
create table entities (
  id            uuid primary key default gen_random_uuid(),
  namespace_id  uuid not null references namespaces(id) on delete cascade,
  name          text not null,
  type          text,                              -- 'person' | 'place' | 'org' | 'thing' | 'concept'
  aliases       text[] not null default '{}',
  description   text,                              -- short context used for disambiguation
  is_self       boolean not null default false,    -- the user ("I", "me")
  embedding     vector(768),                       -- embeds "name (type): description"
  created_at    timestamptz not null default now()
);
create unique index entities_one_self on entities(namespace_id) where is_self;

-- Semantic memory: immutable fact versions with bitemporal validity
create table facts (
  id                 uuid primary key default gen_random_uuid(),
  namespace_id       uuid not null references namespaces(id) on delete cascade,
  subject_id         uuid not null references entities(id),
  predicate          text not null,
  predicate_ad_hoc   boolean not null default false,  -- not in the registry
  object_id          uuid references entities(id),
  object_literal     text,
  statement          text not null,                   -- natural-language rendering, embedded
  embedding          vector(768),
  confidence         real not null default 0.8,
  importance         real not null default 0.5,
  pinned             boolean not null default false,  -- exempt from decay
  access_score       real not null default 0,         -- exponentially decayed access count
  last_accessed_at   timestamptz,
  -- valid time: when the fact was true in the world
  valid_from         timestamptz not null,
  valid_from_source  text not null default 'episode' check (valid_from_source in ('explicit','episode','unknown')),
  valid_to           timestamptz,
  -- record time: when the system held this belief
  recorded_at        timestamptz not null default now(),
  invalidated_at     timestamptz,
  -- lineage
  revises            uuid references facts(id),       -- the version this row replaced
  superseded_by      uuid references facts(id),       -- the fact that ended this one's validity
  status             text not null default 'active'
                     check (status in ('active','superseded','retracted','revised')),
  tier               text not null default 'working'
                     check (tier in ('working','long_term','archived')),
  source_episode_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  check ((object_id is null) <> (object_literal is null)),
  check (valid_to is null or valid_to > valid_from),
  check (invalidated_at is null or invalidated_at >= recorded_at)
);

-- Audit trail of every resolution decision
create table fact_revisions (
  id            uuid primary key default gen_random_uuid(),
  namespace_id  uuid not null references namespaces(id) on delete cascade,
  old_fact_id   uuid references facts(id),
  new_fact_id   uuid references facts(id),
  kind          text not null check (kind in
                  ('update','correction','backfill','merge','coexist','reject',
                   'retraction','archive','restore')),
  resolver      text not null check (resolver in ('rule','llm','manual','decay')),
  candidate     jsonb,                            -- the extracted candidate (for rejects/audits)
  reason        text,
  created_at    timestamptz not null default now()
);

-- Simple per-namespace rate limiting for the public demo
create table rate_limits (
  namespace_id  uuid not null references namespaces(id) on delete cascade,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (namespace_id, window_start)
);
```

Indexes: HNSW on all three embedding columns; GIN full-text on `episodes.content` and `facts.statement`; btree on `facts(namespace_id, subject_id, predicate) where invalidated_at is null`, `facts(namespace_id, tier)`, `episodes(namespace_id, session_id, occurred_at)`, and `entities(namespace_id, lower(name))`.

### 5.1 Bitemporal semantics (the differentiating engineering)

- **Valid time** (`valid_from`, `valid_to`) describes the world. **Record time** (`recorded_at`, `invalidated_at`) describes the system's belief. "Sam moved to Berlin in March", learned in June, gets `valid_from = March`, `recorded_at = June`.
- **Fact rows are immutable versions.** Only `invalidated_at`, `status`, `superseded_by`, `tier`, `pinned`, and the access fields are ever updated in place. Changing a fact's validity window means invalidating the old row and inserting a new version that points to it via `revises`. This is what makes record-time queries correct.
- `invalidated_at` means exactly one thing: *the system stopped holding this row as a belief.* A fact that was true and stopped being true is **not** invalidated. Its window is closed in a new version.

**Unknown starts.** A fact can end at a known time with no stated start ("before that, I lived in Marseille"). It is stored with `valid_from = '-infinity'` and `valid_from_source = 'unknown'` (a CHECK keeps the two in step). The canonical query needs no special case, since `-infinity <= T` for every `T`. In application code the unknown start is the earliest representable `Date`.

**Status** is a denormalized label for the UI. Queries never filter on it; they filter on time columns, and on lineage (`revises`) where versions matter.

| status | meaning | `invalidated_at` |
|---|---|---|
| `active` | current belief, valid window open | null |
| `superseded` | current belief, valid window closed (the world changed) | null |
| `retracted` | the system was wrong (bad extraction, user correction) | set |
| `revised` | an older version of a still-believed fact (e.g. open-ended row replaced by a closed copy) | set |

**The canonical query.** "What did the system believe at record time K about the world at valid time T":

```sql
recorded_at <= :K and (invalidated_at is null or invalidated_at > :K)
and valid_from <= :T and (valid_to is null or valid_to > :T)
```

`K` and `T` both default to now. Retracted facts naturally disappear for `K` after the retraction, and still appear for `K` before it. The archived tier is excluded unless `include_archived` is set.

Episodes use the analogous filter: `occurred_at <= T and created_at <= K`.

**Deletion.** Nothing is hard-deleted by default. `forget` archives or retracts. Hard purge is a separate, explicit path (§9.3).

---

## 6. Pipelines

### 6.1 Write path

The write path is split into a fast step and a slow step so interactive clients don't wait on the LLM.

**`ingest(namespace, content, sessionId, role, occurredAt?)` — fast, synchronous**
1. Store the episode; embed content. Return the episode id.

**`process(episodeId)` — slow; awaited or run after the response**
1. **One LLM call** returns zod-validated JSON with `importance` and candidate facts: `{subject, predicate, object, statement, valid_from?, valid_to?, is_correction, confidence}`. Combining importance scoring and extraction into one call halves quota use.
   - Predicates are constrained to the registry enum (§7.1), with `ad_hoc` allowed as an escape hatch. Ad-hoc candidates pass through the synonym map before being flagged `predicate_ad_hoc`.
   - First-person references resolve to the namespace's `is_self` entity.
   - Relative dates ("last week", "since March") resolve against the episode's `occurred_at`, never against wall-clock now. The model returns *temporal hints* (absolute date, relative offset, or named period), never computed dates; code resolves them.
   - A window's start resolves to the start of its period; so does its end, so "Lyon from 2015 to 2018" meets "Paris since 2018" instead of overlapping it. When both bounds name the same period ("in summer 2023"), the end is that period's end. A fact that ended before the turn with no stated start gets an unknown start (§5.1) rather than one defaulted to the turn, which would invent a current fact; an end that isn't after the start is discarded.
   - Episodes with `role = 'tool'` are **not** extracted by default (`extractFromToolOutput = false`). This prevents web pages and file contents from planting facts.
2. **Entity resolution**, under a per-namespace advisory lock so concurrent writes can't create duplicates. The lock is transaction-scoped (`pg_advisory_xact_lock`), so it is safe behind a transaction-mode pooler (Neon's PgBouncer); session-level advisory locks are not used anywhere.
   1. Exact normalized name and type match.
   2. Alias match.
   3. Embedding similarity on `"name (type): description"` ≥ 0.85.
   - If multiple candidates pass (two different Sams), an LLM disambiguation call picks one or declares a new entity.
   - A single name or alias match also goes to disambiguation when both sides have descriptions and their labels are less similar than `descriptionConflictThreshold` (0.95, tuned on dev). Otherwise "Sam from work, my manager" would merge into an existing "Sam, my brother".
   - If none pass, create the entity. Append an alias when a new surface form maps to an existing entity.
   - **No LLM call under the lock.** The ladder runs and disambiguation happens outside any transaction; the plan is then re-checked under the lock, and if a concurrent writer changed the candidates the flow restarts (bounded retries).
3. **Conflict detection and resolution** per candidate (§7).
4. Persist facts with provenance (`source_episode_ids`); embed statements; set `processed_at`.

**Who awaits `process`:**
- Chat playground: runs it after the response (Next.js post-response work; verify the current API at build time).
- MCP `engram_remember`: awaits by default so the agent sees what was stored (`wait: false` opts out).
- Bench: always awaits.

### 6.2 Read path — `recall(namespace, query, k=8, validAt?, knownAt?, includeArchived=false, trackAccess=true)`

1. Embed the query.
2. **Candidate lists**, each pre-filtered by the §5.1 temporal predicates:
   - vector top-40 over facts
   - vector top-20 over episodes
   - FTS top-20 over facts and episodes, with the query's lexemes OR-ed (an AND query of a natural question matches almost nothing)
3. **Graph expansion:** for entities appearing in the top-10 candidates (directly, or through the facts an episode produced), pull their 1-hop facts under the same temporal filter, as a fourth ranked list. The user's own entity is not expanded: nearly every fact touches it.
4. **Fusion:** reciprocal rank fusion across the lists (`k_rrf = 60`), then a mild prior: `score = rrf · (1 + 0.1·recency + 0.1·importance)`.
   - Recency is `exp(−age/30d)`, where age is measured from `valid_from` (facts) or `occurred_at` (episodes) to `validAt`.
   - A min-max-normalized weighted-linear ranker is kept as an alternative; the dev split decides (ADR-010: RRF).
   - **Determinism:** lists are re-ranked by exact similarity, and every tie breaks on content (text, valid time), never on row ids. Identical histories in different namespaces give identical recall, which also makes responses cacheable and replayable.
5. **Abstention floor:** if the best raw cosine similarity is below `θ_floor` (0.5, ADR-010), return an explicit empty result. Final abstention happens in the composer (§6.3); on dev and dev-long the composer does all of it, and the floor is a safety net.
6. Return top-k with provenance (source episodes, validity window, record window, status).
7. **Access tracking:** only when `trackAccess` is true and only for memories the caller actually used. For chat this is the composer's `used_memory_ids`; for MCP recall it's every returned memory. Dashboard browsing passes `trackAccess = false`. Accesses are applied in one batched write: `access_score += 1`, `last_accessed_at = now()`, and archived hits are restored to `working`.

### 6.3 Answer composition (chat playground and bench)

Recalled memories are passed to the model inside a clearly delimited block marked as untrusted data, never as instructions. Each statement is capped in length.

The composer returns zod-validated `{ answer, supported: boolean, used_memory_ids[] }`. When `supported` is false, the answer is an explicit "I don't know." This keeps abstention a reasoning decision rather than a brittle score threshold.

### 6.4 Background jobs

- **Decay sweep:** the SQL function `engram_decay_sweep(now, …params)`. Because `now` is a parameter, simulated-clock tests call it directly; `pnpm jobs:maintain` calls it with the real time and parameters from `config` and the registry.
- **Demo cleanup:** the SQL function `engram_cleanup_demo(now)` deletes expired demo namespaces (cascade), also run by `pnpm jobs:maintain`. Nightly is enough for 24h demo namespaces on 1 GB of storage; P09a may also run it opportunistically when a demo session is created.
- **Consolidation:** `pnpm jobs:consolidate` (`--hosted` for `HOSTED_DATABASE_URL`, `--estimate` to print the call estimate and stop), and on demand via `engram_consolidate`.
- **Schedule:** `.github/workflows/nightly.yml` runs `jobs:maintain --hosted` then `jobs:consolidate --hosted` once a day, just after the Gemini quota resets. It's the hosted database's only daily wake-up (a few CU-minutes of Neon's 100 CU-hours a month), and it skips cleanly without the secret. Nothing here runs inside a Vercel function. pg_cron isn't used: on Neon's free plan the compute scales to zero and cron would only fire while it's awake (ADR-014).

---

## 7. Conflict resolution & temporal validity (the heart of the project)

### 7.1 Predicate registry

`packages/core/src/conflict/predicates.ts`. Each predicate declares:
- `cardinality: 'one' | 'many'`
- `mutability: 'static' | 'dynamic'`
- `synonyms: string[]`
- `symmetric?: boolean`: `a p b` means `b p a`. Such facts are stored one way round (the user as subject, else the lower entity id), so a restatement in the other direction merges.

| predicate | cardinality | mutability | symmetric | synonyms |
|---|---|---|---|---|
| `lives_in` | one | dynamic | — | resides_in, based_in, moved_to, home_city, lived_in, resided_in |
| `works_at` | one | dynamic | — | employed_by, job_at, worked_at |
| `birth_date` | one | static | — | born_on |
| `is_named` | one | static | — | — |
| `likes` | many | dynamic | — | — |
| `visited` | many | dynamic | — | — |
| `occupation` | one | dynamic | — | has_occupation, job_title, profession, works_as, job, role, has_job |
| `sibling_of` | many | static | yes | sister_of, brother_of, has_sister, has_brother, sibling, has_sibling |
| `partner_of` | one | dynamic | yes | has_partner, partner, in_relationship_with, dating, married_to, spouse_of |
| `allergic_to` | many | dynamic | — | is_allergic_to, has_allergy, allergy |
| `has_pet` | many | dynamic | — | pet, owns_pet, has_dog, has_cat |
| `plays` | many | dynamic | — | plays_instrument, plays_the |
| `learning` | many | dynamic | — | is_learning, studying, studies, learning_language |

Past-tense synonyms are safe: the validity window, not the predicate, says when a fact held.

Extraction is constrained to registry names, and ad-hoc predicates are normalized through the synonym map before storage. The **ad-hoc rate** (share of facts with `predicate_ad_hoc`) is a tracked metric. If it climbs, the registry is missing something.

### 7.2 Resolving a new candidate

Let the candidate be `c` with window `[c.from, c.to)`. `c.from` defaults to the episode's `occurred_at` with `valid_from_source = 'episode'`. Predicates outside the registry are treated as `cardinality: 'many'`, `mutability: 'dynamic'`, so unknown relations coexist rather than wrongly superseding each other.

1. Fetch current-belief facts `E` (`invalidated_at is null`) with the same `(namespace, subject, predicate)`, **including closed (superseded) ones**. They're needed for out-of-order handling.
2. If `E` is empty → insert `c` (no revision row: there is nothing to resolve).
3. **Merge.** If some `e ∈ E` has the same object and an overlapping or adjacent window. "Same object" means the same entity; otherwise the same label (entity name or literal, so a literal "Toronto" and the entity Toronto match); otherwise, for two literals, statement-embedding similarity ≥ `mergeThreshold`. Two *different* entities never merge by embedding ("Bern" and "Berlin" read alike). On a merge:
   - Append provenance.
   - Raise confidence (noisy-OR, capped at 0.99) **only if `c` cites episodes not already in `e.source_episode_ids`**. Re-extraction during consolidation must not double-count evidence.
   - If `c` carries an explicit bound that `e` only had by default, use it; an explicit end closes an open `e`, and a closed `e` only ever extends.
   - Any of these changes writes a new version of `e` (they are content changes). Log `merge` either way.
4. **Coexist.** For `cardinality: 'many'`, insert `c`. Both stay current. A correction cue on a multi-valued predicate goes to the adjudicator instead.
5. **Single-valued predicates.** Checks run in this order:
   1. **Correction cue.** `c.is_correction` ("actually", "no, I never…"). Retract the overlapping (or current) `e`: `invalidated_at = t`, `status = 'retracted'`. Insert `c`; without stated bounds, `c` takes over `e`'s window ("it was Acme all along"). Log `correction`. This comes before update, or a correction would be read as a change of job.
   2. **Noise.** `c.confidence < 0.4` and an overlapping `e` has `confidence ≥ 0.8` → reject `c`; keep it in `fact_revisions.candidate`. Log `reject`.
   3. **Static predicates** skip update and backfill: any remaining contradiction goes to the adjudicator, which may only answer correction or reject.
   4. **Effective window.** An open-ended `c` that starts before known history ends where the next known row begins ("Lyon from 2015", learned after Berlin).
   5. **Backfill.** `c` overlaps nothing in `E` and precedes some row: insert `c` with its (effective) end, `status = 'superseded'`, `superseded_by =` the next row. Leave `E` untouched. Log `backfill`. A `c` that overlaps nothing and precedes nothing is a plain insert.
   6. **Update.** `c` overlaps only the open `e`, is itself open-ended, and starts after `e`. Insert `c`; write a closed version of `e` (`valid_to = c.from`, `superseded_by = c.id`, `revises = e.id`, `recorded_at = t`); set `e.invalidated_at = t`, `e.status = 'revised'`. Log `update`. Ids are generated in the application, so `c` exists before the copy references it.
   7. **Anything else** goes to the LLM adjudicator: overlap with closed history, the same start as the open value, a closed window inside it. It answers **update**, **correction**, **coexist** (both true at once; it may flag the predicate for reclassification) or **reject**, and the mechanics above apply. An answer the mechanics can't apply (an update to a closed row, a disallowed choice) becomes coexist or reject, with the reason recorded.
6. **One timestamp.** Every write in a resolution uses one transaction timestamp `t`, read from the engine's clock inside the lock. A new version's `recorded_at` equals its original's `invalidated_at`, so a `knownAt` query at any instant sees exactly one of them: no gap, no overlap.
7. **Locking.** Classification runs under the namespace lock against fresh beliefs, and rule decisions apply immediately. Only adjudication leaves the lock: the adjudicator is asked outside any transaction, and its answer applies only if `E` is unchanged when the lock is retaken; otherwise the loop re-classifies. (Re-checking outside the lock for rule decisions starves under many concurrent restatements of one fact.)
8. **Every resolution writes one `fact_revisions` row** (merge, coexist, update, backfill, correction, reject), with the candidate and the resolver (`rule` or `llm`). The entity timeline renders this chain; it's the demo money-shot.

### 7.3 Temporal APIs

- `recall(..., validAt, knownAt)`:
  - `validAt` only answers "what was true at T."
  - `knownAt` only answers "what did we believe at K about now."
  - Both together answer the full bitemporal question.
- `history(entity, predicate?, { includeRevised = false })` returns the timeline ordered by valid time, with every row's record window.
  - `includeRevised` adds the replaced versions. This is the record-time audit view.

### 7.4 Required test cases (table-driven, Phase 3)

1. Paris → Berlin update: the closed copy has the correct windows, and the original is marked revised.
2. `validAt` straddling the move returns the right city on each side.
3. `knownAt` before the move was learned returns Paris as current; after, Berlin.
4. User correction retracts a fact. It is absent for `knownAt ≥ retraction` and present before.
5. Out-of-order backfill: older Paris history learned after Berlin, and Berlin stays current.
6. Static-predicate contradiction resolves only as correction or reject.
7. Multi-valued coexistence.
8. Merge on paraphrase.
9. Merge does not raise confidence when the provenance overlaps.
10. Noise rejection.
11. Predicate synonym normalization: `resides_in` conflicts with `lives_in`.
12. Relative date resolution against `occurred_at`.
13. A backfill candidate that overlaps an existing closed history row goes to the adjudicator, not the rule fast-path.
14. No `knownAt` gap or overlap at the update instant: at `t`, at `t − ε`, and at `t + ε`, exactly one row (open original or closed copy) is believed.

---

## 8. Consolidation

Purpose: compress episodic memory into durable semantic memory on a schedule — the "sleep" phase.

- **Trigger:** nightly job, plus a manual tool. Sessions with ≥ 12 unconsolidated episodes are prioritized, then the oldest first. A run summarizes at most `maxClustersPerRun` clusters (20) to bound quota use; the rest wait for the next run.
- **Grouping:** unconsolidated, already-extracted `kind = 'turn'` episodes (never tool output) are grouped by namespace and session, split where consecutive embeddings drift apart (cosine < 0.5), and capped at 12 turns.
- **Budget skip:** a cluster whose turns all score below `minImportance` (0.3) is small talk: it's marked `consolidated` without a model call.
- **Summarize:** the LLM produces two things per cluster:
  - fact candidates with validity hints, each **citing the turns that support it** (turns are labelled `t1…tn`; ids never reach the prompt). A candidate's provenance is exactly its cited turns, and its hints resolve against the latest cited turn;
  - a one-paragraph summary, stored as an embedded, recallable `kind = 'summary'` episode with `summarizes` set. Summaries are never extracted. Source episodes are marked `consolidated`.
- **Reuse:** every candidate goes through the normal write path (§6.1 steps 2–4), the same `resolveCandidates` pipeline extraction uses. Provenance-aware merge (§7.2.3) means a fact re-extracted from its own turns merges with confidence unchanged; only a newly cited turn raises it.
- **Tiering:** facts created or confirmed by consolidation move from `working` to `long_term`. This is the **only** path into `long_term` (a test scans the source to enforce it). Versions copy their tier, so the history of a long-term fact stays long-term.
- **After a purge:** a summary deleted by a hard purge (§9.3) leaves its surviving turns unconsolidated, so the next run regenerates it; the run first re-embeds turns whose embeddings a redaction removed.

---

## 9. Decay and forgetting

### 9.1 Retention score

Recomputed by the daily sweep:

```
access_score ← access_score · exp(−Δt / τ_tier)          (decayed each sweep; +1 per access)

score = 0.50 · exp(−days_since_last_access / τ_tier)
      + 0.25 · min(1, ln(1 + access_score) / ln(21))
      + 0.25 · importance

τ_working = 14 days, τ_long_term = 90 days, θ_archive = 0.15
```

`days_since_last_access` falls back to `recorded_at` when a fact has never been accessed.

**Invariant (tested).** As recency and access decay to zero, the score approaches `0.25 · importance`. So a non-pinned fact is archivable by decay if and only if `importance < θ_archive / 0.25 = 0.6`.

For a default-importance fact (0.5) that is never accessed, the score crosses θ after roughly `3τ`: about 42 days in `working`, about 270 days in `long_term`. Facts with importance ≥ 0.6 are effectively permanent unless forgotten explicitly. This is intentional, and the test suite asserts both the invariant and the crossing times.

**Numerics.** Postgres raises on a `double` that underflows instead of returning 0, and `access_score` is a `real` column. The sweep therefore clamps its exponents at −700 and stores a decayed access score below 1e-30 as 0 (migration 0006). Without that, one fact untouched for ~745·τ days, or a far-future simulated sweep, made every sweep fail.

### 9.2 Sweep rules

- Only current beliefs are scored (`invalidated_at is null`); replaced versions never are. Closed history rows are current beliefs and decay like any other.
- `access_score` decays by `exp(−Δt / τ_tier)`, where Δt is the time since the previous sweep that covered the namespace, recorded in `engram.decay_sweeps` (which also answers stats' "last sweep").
- Any non-archived current belief with `score < θ_archive` → `tier = 'archived'`, except:
  - pinned facts;
  - facts with static predicates (from the registry: `birth_date`, `is_named`, `sibling_of`);
  - current-belief facts whose subject is the `is_self` entity and whose predicate is `is_named`.
- Each archive logs a `fact_revisions` row with `kind = 'archive'`, `resolver = 'decay'`, stamped with the sweep's `now`.
- Decay never moves facts between `working` and `long_term`. Archived facts are excluded from default retrieval and restored to `working` on an `include_archived` hit or manually.
- Weights, τ values, and thresholds live in `packages/core/src/config` (source of truth) and are passed as arguments to the SQL function. The dev split is the regression harness for tuning them.

### 9.3 `forget` modes

- **`archive`** (default) — reversible: `restore` returns the fact to `working`. Both log a `manual` revision.
- **`retract`** — the belief was wrong. Sets `invalidated_at` (status `retracted`) and logs a `retraction` revision.
- `forget` targets a fact id, or an entity's current beliefs (optionally for one predicate).
- **`hard`** — irreversible purge; requires an explicit flag. It cascades to every place the information lives:
  1. the fact rows and all their versions (`revises` chain);
  2. `fact_revisions` rows referencing them, including `candidate` payloads;
  3. source episodes, or redaction of the relevant content when an episode holds other facts;
  4. consolidation summaries whose `summarizes` include purged episodes, which are regenerated or deleted;
  5. all associated embeddings.

  The purge runs in one transaction, in this order, because facts reference each other (`revises`, `superseded_by`) and `fact_revisions` references facts:
  1. compute the purge set: the target facts plus their whole `revises` chain in both directions;
  2. null out `superseded_by` and `revises` on rows *outside* the purge set that point into it;
  3. delete `fact_revisions` rows whose `old_fact_id` or `new_fact_id` is in the set, and any whose candidate came from a purged turn;
  4. delete the fact rows (their embeddings go with them);
  5. episodes: a source episode that backs no remaining fact is deleted. In every other episode of the namespace, mentions of the purged value's *terms* are redacted in place, so the rest of the turn survives; a source episode where the value was only implied is redacted whole. Changed episodes lose their embeddings. The terms are the purged literals no remaining fact uses, plus the names and aliases of entities the purge leaves without facts.
  6. delete the summaries over any changed or deleted episode (consolidation regenerates them, P06b);
  7. delete the entities the purge left without facts (never the self entity).

  Values still known elsewhere (an entity other facts use) are not redacted: the purge removes *this* information, not every mention of a shared name.

  A purge test asserts that a full-text search for the purged literal returns nothing afterwards.

---

## 10. MCP server (`packages/mcp`)

Use the **official TypeScript MCP SDK**: v2, `@modelcontextprotocol/server` (verified 2.3.1, 2026-10-17; ADR-013). One factory, `createEngramServer({ db, provider, namespaceId })`, builds a server scoped to one namespace, and both transports use it. The server still negotiates the 2025 protocol revisions for older clients.

**Namespace selection**
- stdio: the `ENGRAM_NAMESPACE` environment variable (a slug, default `default`, created as a `user` namespace if missing).
- HTTP: `ENGRAM_MCP_TOKENS` maps each bearer token (≥ 24 characters, compared in constant time) to a namespace slug. A missing or unknown token gets 401 before any server is built.
- **Isolation is enforced in core:** `history()` takes the namespace, entity references resolve only inside it, and `forget` targets only its facts. Another namespace's ids find nothing.

**Tools** (zod input schemas; concise deterministic text plus structured content). Descriptions explicitly tell the agent *when* to call each tool: recall at the start of a task, remember durable user facts, preferences, and decisions.

- `engram_remember { content, session_id?, occurred_at?, wait? = true }` → episode id plus a summary of extracted, merged, updated, and rejected facts. Content is stored with role `user`, and `session_id` defaults to `mcp-YYYY-MM-DD` (UTC) so one day's remembers cluster for consolidation. With `wait: false` it returns `pending`, and an episode left unprocessed is finished by `processPending` on the next server start or `engram_consolidate`.
- `engram_recall { query, k?, valid_at?, known_at?, include_archived? }` → ranked memories with provenance, validity windows, and record windows. It tracks access for everything returned (§6.2).
- `engram_history { entity, predicate?, include_revised? }` → revision timeline.
- `engram_entities { query, limit? }` → entity search: names and aliases containing the query, then labels with embedding similarity ≥ 0.7, with fact counts.
- `engram_forget { fact_id? | entity + predicate?, mode: 'archive'|'retract'|'hard', confirm_hard?, reason? }`. A hard purge without `confirm_hard: true` returns an error and changes nothing.
- `engram_consolidate {}` → processes pending episodes, then runs consolidation for the namespace.
- Resource `engram://stats` → counts by tier and status, ad-hoc predicate rate, last sweep, latest bench score. The score is the newest `bench/reports/<run>.json` summary from a run that composed answers, or `null` where there are no reports (a deploy).
- **Entity references** (`entity`) accept an id, a name or alias (case-insensitive), or `user`/`me`/`self`. An ambiguous name returns an error listing the candidates' ids; it never guesses.
- **Errors** an agent can act on (bad input, unknown or ambiguous entity, nothing to forget, an unconfirmed hard purge) come back as `isError` results with a one-line message.

**Transports**
- stdio binary for local clients (Claude Code, Claude Desktop, Cursor), `packages/mcp/src/stdio.ts`, launched through the package's own `tsx`. stdout carries only the protocol; diagnostics go to stderr. `docs/mcp.md` has copy-paste config for each client (the README copies it in P10).
- Streamable HTTP at `/api/mcp` in the Next.js app, bearer-protected: P09a mounts `createEngramHttpHandler(…).fetch`, a stateless web-standard handler, unchanged.

**Known limitation (documented):** recall quality depends on the client actually calling `engram_remember`. Agents sometimes skip it or store paraphrases rather than raw turns.

**Definition of done:** a recorded MCP Inspector session, plus an integration test that drives the server through the SDK client (in-memory, in-process HTTP, and the spawned stdio binary). Both are in `docs/mcp.md` and `packages/mcp`.

---

## 11. HTTP API (for the web app)

Thin Next.js route handlers over `packages/core`.

**Bearer-protected**
- `POST /api/remember`
- `POST /api/recall`
- `GET /api/memories` — filter by tier, status, predicate, q; sort by retention score
- `GET /api/entities/:id/timeline`
- `GET /api/evals` — bench reports
- `/api/mcp`

**Demo (anonymous, rate-limited)**
- `POST /api/demo/session` — creates a `demo` namespace with a 24h expiry, set in an httpOnly cookie. Throttled per client IP (hashed, never stored raw), since otherwise a visitor could mint unlimited namespaces and sidestep the per-namespace limit.
- `POST /api/chat` — streams; operates only on the cookie's namespace; 30 turns/hour per namespace via `rate_limits`.
- A **global daily turn cap** across all demo namespaces protects the free Gemini quota. When it's reached, the chat returns a clear "demo quota exhausted, try again tomorrow" message and the read-only showcase stays available.

**Connection pooling.** Vercel functions connect to Neon's direct endpoint with a small pool (`max: 1` per function instance, a short idle timeout). A free 0.25 CU compute accepts about 100 connections, plenty for the demo. Neon's pooled endpoint (PgBouncer, transaction mode) would also need prepared statements off, and it resets each session's search path, so using it means setting the path inside every transaction. P09a decides whether traffic warrants that. Locks are transaction-scoped either way.
- Read endpoints are scoped to the cookie namespace, or to the seeded read-only showcase namespace.

---

## 12. Web app (`apps/web`)

Next.js App Router + Tailwind + shadcn/ui + TanStack Query. Verify current Next.js and AI SDK versions at build time.

**Required pages**
- `/chat` — playground.
  - Each visitor gets an ephemeral namespace.
  - Session switcher (create/rename).
  - Streaming chat where the assistant's context is recalled memories only.
  - Side panel showing which memories were used (the composer's `used_memory_ids`), with provenance links.
  - The demo: tell it facts in session A, open session B, watch it remember; contradict a fact, watch the timeline update.
- `/entities/[id]` — fact timeline: horizontal validity bars per predicate, superseded/retracted styling, revision chain, and a "show record-time history" toggle (`includeRevised`). This is the conflict-resolution money-shot.
- `/memories` — inspector table: search, filter by tier/status/predicate, sort by retention score; a row expands to provenance.
- `/evals` — bench runs: per-category accuracy across all four modes, LongMemEval number, run history.
- `/` — short landing: what Engram is, the showcase namespace's live stats, links.

**Stretch:** `/graph` — force-directed entity–fact graph with `valid_at` and `known_at` sliders.

**Design bar:** clean, dense, fast; dark-mode friendly; no lorem ipsum anywhere.

**Data notice:** the chat playground shows a persistent "don't enter personal data" notice, because the free Gemini tier may use inputs to improve Google's products.

---

## 13. Engram-Bench (`bench/`)

### 13.1 Splits

- **dev** (40 items, mixed categories) — used for all tuning: ranking, thresholds, decay weights, prompts.
- **test** (200 items, frozen) — **never used for tuning**. Run for reports only. Any change motivated by test results is a red flag and needs an ADR.

| Category (test) | Count | Tests |
|---|---|---|
| cross_session_recall | 60 | facts from session i asked in session j |
| knowledge_update | 40 | post-update answers use the new fact; old fact reachable via `valid_at` |
| temporal_reasoning | 30 | "where did X live before Berlin", `valid_at` and `known_at` questions, out-of-order information |
| single_session_recall | 30 | sanity floor |
| multi_hop | 20 | join across entities/facts |
| abstention | 20 | unanswerable; the correct answer is "I don't know" |

Item schema:

```
{ id, split, category, setup_sessions: [{session_id, occurred_at, turns[]}],
  question, valid_at?, known_at?, expected, judge: 'exact'|'contains'|'llm', notes }
```

### 13.2 Generator rules (to avoid grading Engram on its own assumptions)

`bench/dataset/generate.ts` produces seeded synthetic personas and events, but scenario generation must not see the predicate registry:
- At least 30% of facts use relations outside the registry.
- Restatements are paraphrased.
- Some updates are implicit ("I've been enjoying the Berlin winters").

Then one human review pass, after which `dev.json` and `test.json` are frozen and committed. They are never regenerated silently.

### 13.3 Runner

Per item:
1. Create a fresh `bench` namespace.
2. Replay setup sessions through the real write path, with their historical `occurred_at`.
3. Ask the question through the mode under test plus the shared answer composer (§6.3).
4. Judge.

**Modes**

| mode | what it does |
|---|---|
| `buffer` | raw last-N turns |
| `rag` | vector search over episodes only; no facts, conflicts, or time |
| `full_context` | the entire item history in the model's long context — the honest baseline |
| `engram` | the full system |
| `engram_consolidated` | opt-in (not in `all`): `engram`, plus a consolidation run an hour after each session ends |

Engram is expected to beat `rag` broadly. The interesting claim is *where* it beats or loses to `full_context` (updates, as-of questions, cost, latency) and by how much. Report that honestly either way.

**Quota-aware operation**
- An LLM response cache keyed by `(model, prompt hash)` in `bench/cache/`.
- Resumable runs.
- Exponential backoff on rate limits.
- A pre-run estimate of the LLM call count and tokens, printed before starting.

### 13.4 Judging

- `exact` and `contains` judges are deterministic.
- The `llm` judge uses a separately configured model, preferably a **different model family** from extraction and composition.
- Judge validity: 40 test answers are hand-labeled once, and judge agreement with the human labels is reported alongside the results.

### 13.5 Metrics

- Accuracy per category and mode.
- Retrieval recall@8 (engram and rag).
- Update accuracy.
- Abstention precision and recall.
- Ad-hoc predicate rate.
- Duplicate-entity rate.
- Latency p50/p95.
- **LLM calls and tokens per item** (cost).

Reports go to `bench/reports/<date>.md`; the summary table is copied into the README.

### 13.6 External benchmark (required, Phase 8)

`bench/longmemeval/` adapts a subset of LongMemEval-S (target ~100 items, stratified by its question types) to the runner. Check the dataset's repo, license, and format at build time. Report the engram and full_context numbers on it next to the internal ones.

LongMemEval-S histories are long (on the order of 115k tokens per item), so `full_context` is the expensive mode. If the pre-run estimate exceeds what the free tier allows in a reasonable number of days, shrink to a smaller stratified subset (at least 50 items) and record the size and reason in an ADR. Never drop question types to fit.

### 13.7 CI

- Every PR: a 20-item smoke subset from **dev** through all four modes, and again through `engram_consolidated` (opt-in elsewhere), `exact`/`contains` judges only, replayed from committed recorded HTTP responses (`bench/fixtures/smoke-cache/`) by the real providers in read-only cache mode — no network, no keys, no cost. Providers keep database ids out of prompts so request bodies are deterministic.
- `bench.yml`: full test and LongMemEval runs, manually triggered or nightly, with API keys from secrets.

---

## 14. Providers & free-tier stack

Provider adapter in `packages/core/src/providers/`:

| method | purpose |
|---|---|
| `embed()` | embeddings |
| `processEpisode()` | importance + extraction, one call |
| `disambiguate()` | entity disambiguation |
| `adjudicate()` | conflict adjudication |
| `summarize()` | consolidation |
| `compose()` | answer composition |
| `judge()` | bench judging |

A deterministic `FakeProvider` backs the unit tests, which never hit the network. The judge provider is configured independently of the others.

| Concern | Default (free) | Notes |
|---|---|---|
| DB, local / tests / CI | `pgvector/pgvector` Docker image | Via `docker-compose.yml` locally and as a GitHub Actions service container. Small and offline |
| DB, hosted (vectors / FTS) | Neon free tier (ADR-014) | Postgres 18 with pgvector 0.8.6. 1 GB storage per project, 100 CU-hours a month, 5 GB egress a month, scale to zero after 5 idle minutes (verified 2026-10-17). Exceeding compute or egress suspends the compute until the next month; exceeding storage makes writes fail. Nothing is deleted. Wake-ups cost a few hundred ms on the first query |
| Embeddings + LLM | Gemini API free tier (AI Studio key) | Verify current model names, embedding dimensions, and rate/daily quotas at build time. **Free-tier inputs may be used by Google to improve its products** — stated in README limitations and in the demo UI, since Engram stores personal facts |
| Judge LLM | Groq free tier: `openai/gpt-oss-120b` with strict JSON-schema output; fallbacks: Mistral free tier, Cohere trial | A different family from Gemini, as §13.4 requires. Dataset verbalization uses a third family (`qwen/qwen3.8-27b` on Groq). Verify current models and limits at build time |
| Hosting | Vercel Hobby | web, API, HTTP MCP endpoint. No long-running jobs here; check function duration limits. Connect to Neon's direct endpoint with a small pool (§11) |
| CI + jobs | GitHub Actions free | ci.yml, bench.yml, nightly.yml. Scheduled workflows are auto-disabled after 60 days of repository inactivity; document re-enabling |

Secrets only via `.env` (never committed); `.env.example` kept current. Required keys: `DATABASE_URL`, `GEMINI_API_KEY`, `JUDGE_*`, `ENGRAM_API_TOKEN`, `ENGRAM_NAMESPACE`. Hosted-only: `HOSTED_DATABASE_URL` (Neon direct endpoint, for migrations and jobs) and optionally `HOSTED_POOLED_DATABASE_URL` (pooled endpoint; see §11 before using it).

**Offline mode.** With no API keys set, `pnpm demo:offline` runs the engine against the local database with the FakeProvider. It exists so anyone can see the bitemporal mechanics without signing up for anything.

---

## 15. Milestones

Each phase follows the same loop: plan → approval → implement in small steps → tests, typecheck, and lint green → 3–8 commits → short summary. One phase at a time.

Each phase has a file in `docs/phases/`. Early phases are written in full; later ones start as outlines (goal, dependencies, done-when, risks) and are expanded into a full plan at the start of the phase, which is the "plan" step of the loop. When a phase's plan changes something here, this spec is updated in the same phase.

- **P0 Scaffold.** pnpm workspaces, TS strict, vitest, eslint + prettier, `docker-compose.yml` with the pgvector image, a plain-SQL migration runner (`db:up`, `db:reset`, `db:migrate`, `db:migrate:hosted`) with the `migrations/` vs `hosted/` split (now under `sql/`), migration 0001 (`engram` and `extensions` schemas, pgvector) applied, `.env.example`, `.gitignore` (including agent files and `bench/cache`), CI workflow with a pgvector service container.
  - *Done when:* `pnpm -r typecheck && pnpm -r test && pnpm -r lint` is green locally and in CI, and a fresh clone boots.
- **P1 Store + providers.** Schema with namespaces, constraints, and indexes; repository layer; Gemini and Fake providers; `ingest`; `is_self` entity creation per namespace.
  - *Done when:* repository unit tests pass, including a pgvector round-trip and the CHECK constraints rejecting bad rows.
- **P2 Extraction + entities.** Combined importance + extraction call (zod), predicate normalization, relative-date resolution, tool-output exclusion, entity resolution with advisory lock, disambiguation, and alias learning; provenance.
  - *Done when:* golden-file tests over ~10 fixture conversations pass; a concurrency test proves no duplicate entities; a two-Sams fixture resolves correctly.
- **P3 Conflict + temporal.** Registry, versioned-row mechanics, rule fast-path, LLM adjudication, the `validAt`/`knownAt` query, `history()`, and the `pnpm demo:offline` scenario script (Paris → Berlin, correction, backfill).
  - *Done when:* the §7.4 suite passes, and `pnpm demo:offline` prints the expected bitemporal answers with no API keys set.
- **P4 Bench harness v0.** Generator, frozen dev split (40 items), runner with all four modes, cache, and resumability; CI smoke on dev.
  - *Done when:* all four modes produce a dev report. (Test split not yet frozen.)
- **P5 Retrieval.** Candidate lists, graph expansion, RRF plus priors, the abstention floor, composer with `supported`/`used_memory_ids`, and access tracking. Tuned on dev only.
  - *Done when:* retrieval fixtures pass, and dev recall@8 and accuracy targets are recorded in DECISIONS.md.
- **P6 Jobs.** The decay SQL function with simulated-clock tests (including the §9.1 invariant and crossing times), the nightly schedule (pg_cron at first; GitHub Actions since ADR-014), consolidation via the write path with the provenance-aware merge test, the GitHub Actions workflow, demo cleanup, and the hard-purge cascade with its test.
  - *Done when:* the time-travel and purge tests pass, and the consolidation job runs end-to-end against the local Docker database. Decay and demo cleanup run from the nightly workflow (`pnpm jobs:maintain`), verified against the hosted database.
- **P7 MCP.** Tools and resource, namespace selection, stdio and streamable HTTP, Inspector walkthrough, client config docs.
  - *Done when:* the SDK-client integration test passes, and Claude Code can call `engram_remember` and `engram_recall` locally.
- **P8 Bench full.** Freeze the test split after human review, label the 40 judge-validation answers, build the LongMemEval subset adapter, run everything, and write reports.
  - *Done when:* the test and LongMemEval reports exist, and the README table shows four modes plus judge agreement.
- **P9 Web.** Required pages against the real API, demo namespaces, rate limiting.
  - *Done when:* `docs/demo.md` can be followed without improvisation.
- **P10 Ship.** Neon and Vercel deploy (`db:migrate:hosted` applied); a showcase namespace seed; the README (gif, <10-minute quickstart, architecture diagram, bench tables, design notes, limitations, prior art); `docs/architecture.md`; a DECISIONS.md tidy. Three ways for a reviewer to try it:
  1. the hosted demo: no setup;
  2. `pnpm demo:offline`: Docker only, no API keys;
  3. the full quickstart with a free Gemini key.
  - *Done when:* all three paths are verified from a fresh clone against the README, and the hosted demo is live.

---

## 16. Repository conventions

**Commits**
- Conventional Commits, for example:
  - `feat(core): version facts on validity changes`
  - `fix(bench): make dataset generation deterministic across runs`
  - `test(conflict): cover out-of-order backfill`
  - `chore(ci): cache pnpm store`
- Imperative mood, ≤72-character subject, body only when the *why* isn't obvious. Vary naturally; no boilerplate.
- Small and scoped: one logical change per commit, committed after each green unit of work (~3–8 per phase).
- Linear history: short-lived branches rebased and fast-forwarded, or small commits straight to main early on. No force-pushes after publishing.
- **Commit metadata carries only the author's identity.** No `Co-Authored-By` trailers or "generated with" lines in commits or PR text.

**Agent files:** `CLAUDE.md` and `.claude/` are local working files listed in `.gitignore`, not part of the published repository.

**Quality gates (before every commit):** `pnpm -r typecheck && pnpm -r test && pnpm -r lint`.

**Engineering rules**
- Engine logic (conflict, temporal filters, decay math, consolidation, ranking, purge) gets tests written first or alongside, never after the fact.
- All LLM I/O is validated with zod; unit tests use FakeProvider only.
- New dependencies require a one-line justification and approval first.
- Every significant choice gets a short ADR appended to `DECISIONS.md` (context / decision / consequences, ≤10 lines).
- Tuning decisions cite dev-split results only.
- Secrets are never committed; `.env.example` stays current.

**Git identity & attribution setup (do once, verify in Phase 0)**

```bash
git config user.name  "Your Name"
git config user.email "your-id+username@users.noreply.github.com"  # or the personal email verified on GitHub
```

Local `.claude/settings.json` (gitignored):

```json
{
  "attribution": { "commit": "", "pr": "" },
  "includeCoAuthoredBy": false
}
```

Verification before every push (both must be clean):

```bash
git log --format='%an <%ae>' | sort -u                     # only your identity
git log --format='%B' | grep -iE 'co-authored|generated'   # no output expected
```

---

## 17. README requirements (Phase 10)

1. Hero gif of the chat demo: remember → new session → recall → contradiction → timeline.
2. What and why in five sentences.
3. Quickstart in under 10 minutes (Docker database path), plus the no-key `pnpm demo:offline` path and the hosted demo link.
4. Architecture diagram.
5. **Benchmark tables:** buffer vs. rag vs. full_context vs. engram per category, the LongMemEval subset number, judge agreement, and cost per item. Present wins and losses honestly.
6. MCP client setup snippets (Claude Code, Claude Desktop, Cursor).
7. Design notes: the bitemporal model and the canonical query, versioned fact rows, the decay function and its archival invariant, the consolidation loop.
8. Limitations: free-tier data terms, entity disambiguation, extraction error rates, dependence on clients calling remember.
9. Prior art (Appendix C).

No hype adjectives; let the tables talk.

---

## 18. Risks and open questions

- **Entity disambiguation** (same-name people) is the most likely source of silent errors. Track the duplicate-entity and mis-merge rates on dev.
- **Predicate drift:** if the ad-hoc rate on dev exceeds ~15%, expand the registry before tuning retrieval.
- **Full-context baseline:** may win on small items. If so, that's a finding to report, and it sharpens the pitch toward cost, latency, and temporal queries.
- **Free-tier quotas:** may make full runs multi-day. The cache and resumability exist for this; budget runs from the pre-run estimate.

---

## Appendix A — CLAUDE.md template (local, gitignored)

```markdown
# Engram

Persistent memory engine for AI agents: episodic + semantic memory with
consolidation, decay, conflict resolution, and bitemporal validity.
Exposed over MCP; measured by bench/. Source of truth: docs/SPEC.md.

## Commands
- pnpm -r typecheck · pnpm -r test · pnpm -r lint   (all green before any commit)
- pnpm db:up / db:reset / db:migrate                (local Docker pgvector)
- pnpm db:migrate:hosted                            (Neon: migrations + sql/hosted/)
- pnpm demo:offline                                 (FakeProvider, no API keys)
- pnpm bench --split=dev|test --memory=engram|rag|full_context|buffer
- pnpm bench:longmemeval
- pnpm jobs:maintain [--hosted]                     (decay sweep + demo cleanup; nightly.yml)
- pnpm jobs:consolidate [--hosted] [--estimate]
- packages/mcp/node_modules/.bin/tsx packages/mcp/src/stdio.ts   (MCP stdio server; ENGRAM_NAMESPACE, see docs/mcp.md)

## Working rules
- One phase from docs/SPEC.md §15 at a time. Plan first, wait for approval, then build.
- Tests first or alongside for engine logic. Unit tests use FakeProvider; never hit the network.
- All LLM I/O is zod-validated. Ask before adding any dependency.
- Fact rows are immutable versions; queries filter on time columns, never on status.
- Tune only against the dev split. Never tune on test.
- Append a short ADR to DECISIONS.md for significant choices.
- Secrets only in .env; keep .env.example current.

## Commits — hard rules
- Conventional Commits, imperative, ≤72-char subject, one logical change per commit.
- Commit after each green unit of work; run the quality gates first.
- No Co-Authored-By trailers or "generated with" lines in commits or PR text.
- Never force-push published history.
```

---

## Appendix B — Alternative backend: Graphiti

If the temporal graph should come from a production engine instead of the hand-built one, keep `packages/mcp`, `apps/web`, and `bench`, and swap `packages/core`'s graph internals for **Graphiti**. Graphiti is Zep's open-source temporal knowledge-graph engine; verify its current language, license, and backend support at build time.

Consequences:
- A Python service joins the stack.
- A graph database (Neo4j or FalkorDB) is required.

Choose this path only if the goal shifts from "demonstrate the internals" to "integrate best-in-class components." The bench works unchanged, and an engram-vs-graphiti comparison would make a strong addition. Record the switch as an ADR.

## Appendix C — Prior art (for the README)

| Project | What it is | How Engram differs |
|---|---|---|
| Mem0 | Drop-in memory API layer (add/search, LLM-managed updates) | Engram hand-builds and exposes the update/conflict machinery Mem0 abstracts, and adds record-time as well as valid-time queries |
| Letta (MemGPT) | Agent runtime with self-edited, OS-style tiered memory | Engram is a memory *service* any client uses via MCP, not an agent framework |
| Cognee | Graph + vector ETL pipelines for AI data | Engram focuses on conversational memory dynamics: decay, consolidation, contradiction |
| Zep / Graphiti | Temporal knowledge-graph engine | Engram implements a comparable bitemporal core from scratch and measures it against baselines and LongMemEval (Appendix B keeps Graphiti as a swap-in) |