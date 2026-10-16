# P01 — Store + providers

**Status:** planned

## Goal
Create the full §5 schema and a typed repository layer over it, the provider interface with a deterministic FakeProvider and a Gemini embeddings implementation, and the fast `ingest` path. By the end, an episode can be stored and embedded, and namespaces come with their `is_self` entity.

## Spec refs
§5 (data model, indexes, embedding dimension), §5.1 (immutability rules, which the repository API should make hard to violate), §6.1 `ingest`, §14 (provider adapter, FakeProvider, secrets), §15 P1.

## Depends on / unlocks
- **Depends on:** P00 (runner, DB, CI, postgres.js).
- **Unlocks:** P02 (extraction writes facts and entities through these repositories), P04 (the bench replays through `ingest`).

## Scope
**In**
- Migration 0002 with all §5 tables, constraints and indexes in the `engram` schema.
- The DB client factory.
- Repositories for namespaces, episodes, entities, facts (insert and read by id only) and fact_revisions.
- Vector serialization.
- The provider interface with all seven methods typed and zod schemas for their I/O.
- A FakeProvider covering all seven.
- `GeminiProvider.embed()`, plus a shared structured-JSON call helper.
- `config/` with defaults.
- `ingest()`, and `ensureNamespace()` creating `is_self`.

**Out**
- Gemini prompts for `processEpisode`, `adjudicate`, `summarize`, `compose`, `disambiguate`. Each lands in the phase that needs it (P02, P03, P05, P06b). Until then they throw "not implemented".
- The bitemporal read query (P03).
- `rate_limits` usage (P09a). The table is still created here.

## Deliverables
```
supabase/migrations/0002_core_schema.sql
packages/core/src/
  config/index.ts                # dims, thresholds, decay params (§9.1), RRF k: typed constants
  db/client.ts                   # createDb({url, prepare}): sets search_path, prepare flag
  db/vector.ts                   # toSql(number[]) / fromSql(string), dimension assert
  db/namespaces.ts               # ensureNamespace(slug, kind, expiresAt?) → creates is_self in same tx
  db/episodes.ts
  db/entities.ts
  db/facts.ts                    # insert, getById; no generic "update" (only the §5.1 mutable columns)
  db/factRevisions.ts
  db/testing.ts                  # withTestNamespace(): per-test namespace, cascade cleanup
  providers/provider.ts          # Provider interface + zod schemas per method
  providers/fake.ts
  providers/gemini.ts
  providers/structured.ts        # call → JSON → zod parse → one repair retry → typed error
  ingest/ingest.ts
  types/index.ts                 # domain types inferred from zod / row types
```

## Tasks
1. **Schema migration.**
   - The §5 DDL plus every listed index:
     - HNSW `vector_cosine_ops` on the three embedding columns;
     - GIN on `to_tsvector('english', …)` for `episodes.content` and `facts.statement`;
     - the btrees.
   - FKs referencing `facts(id)` on `revises`, `superseded_by` and the `fact_revisions` columns are plain, non-cascading. P06a's purge orders deletes explicitly (§9.3).
2. **Client + vector helpers.**
   - `createDb` always sets `search_path = engram, extensions`.
   - `prepare` comes from config. It defaults to `true` locally, and P09a sets it to `false` for the transaction pooler.
   - Vector helpers assert length 768 and finite values.
3. **Repositories.**
   - Typed functions, not a generic ORM.
   - `facts.ts` exposes only the updates §5.1 allows: `invalidate(id, at, status)`, `setTier`, `setPinned`, `recordAccess`. There is no way to change content or valid-time columns in place.
4. **Provider interface.**
   - Signatures for `embed(texts, {taskType: 'document'|'query'})`, `processEpisode`, `disambiguate`, `adjudicate`, `summarize`, `compose`, `judge`.
   - Each structured method has zod input and output schemas in `provider.ts`, so the Fake and Gemini share one contract.
5. **FakeProvider.**
   - `embed`: deterministic feature hashing of normalized tokens into 768 dimensions, then L2 normalization. Identical text gives identical vectors, and texts that share words land close together, which is enough for the merge and similarity tests.
   - Structured methods return responses registered by the test (`fake.when(match).respond(output)`). An unregistered call throws, so a test can't pass by accident.
   - Every call is recorded for assertions (`fake.calls`).
6. **GeminiProvider.**
   - `embed` with batching, task types, and `outputDimensionality: 768`. L2-normalize because the output is truncated (§5).
   - `structured.ts`: JSON-mode call, zod parse, one repair retry with the validation error, then a typed `ProviderOutputError`.
   - Exponential backoff on 429 and 5xx, with jitter and a max-retries setting.
7. **ingest.**
   - `ingest(db, provider, {namespace, content, sessionId, role, occurredAt?})` inserts the episode with its embedding and returns the id.
   - `processed_at` stays null; P02's `process` sets it.
   - `role = 'tool'` episodes are stored and embedded as usual. Only extraction skips them (P02).
8. **ensureNamespace.** Creates the namespace and its `is_self` entity (`name = 'User'`, `type = 'person'`, `is_self = true`) in one transaction. It is idempotent on `slug`.

## Tests
- `vectors.test.ts` (unit): round-trip, a wrong dimension throws, NaN throws.
- `fake.test.ts` (unit):
  - embed is deterministic and unit-norm;
  - shared-word texts have higher cosine than unrelated ones;
  - unregistered structured calls throw.
- `gemini.test.ts` (unit, mocked transport, no network):
  - normalization is applied;
  - backoff retries on 429;
  - the repair retry runs once and then throws a typed error.
- `store.int.test.ts` (local DB):
  - pgvector round-trip through the HNSW index (insert 3 vectors, nearest neighbor is correct);
  - each CHECK constraint rejects a bad row: both object columns set, neither set, `valid_to <= valid_from`, `invalidated_at < recorded_at`, a bad enum on `status`, `tier`, `kind`, `role`, `resolver`;
  - a second `is_self` per namespace is rejected by the partial unique index;
  - `ensureNamespace` is idempotent and creates exactly one self entity;
  - deleting a namespace cascades;
  - the facts repo has no content-update function (a type-level test via `expectTypeOf`).
- `ingest.int.test.ts`: stores the episode with its embedding and `occurred_at` (default and explicit), and leaves `processed_at` null.

## Definition of done
- [ ] Migration 0002 applies cleanly to an empty local DB and in CI.
- [ ] All tests above pass. The pgvector round-trip and CHECK rejections are among them.
- [ ] `GeminiProvider.embed` is verified once by hand against the real API (a small script, not a test) with the model and dimension recorded in an ADR.
- [ ] `.env.example` lists `GEMINI_API_KEY`, `GEMINI_EMBED_MODEL`, `GEMINI_CHAT_MODEL`.

## Planned commits
1. `feat(db): add core schema with bitemporal fact columns`
2. `feat(core): add typed repositories and vector helpers`
3. `feat(core): define provider interface with zod contracts`
4. `feat(core): add deterministic fake provider`
5. `feat(core): add gemini embeddings with backoff and normalization`
6. `feat(core): ingest episodes and create self entity per namespace`

## Free-tier notes
- Only the manual embed check touches the API (one call). Every test uses Fake or a mocked transport.
- Embedding batches reduce request count, and RPM/RPD are the binding free limits. Record the current limits in the ADR.

## Risks and verify-at-build-time
- **Verify:**
  - the current Gemini embedding model name and its native dimension;
  - that `outputDimensionality` is supported;
  - the task-type names;
  - the current official JS SDK package name (`@google/genai` at last check).
- **Proposed dependencies:**
  - `zod`: required by the spec for all LLM I/O.
  - the Gemini SDK: the official client. Alternatively use plain `fetch` against the REST API and skip the dependency; decide at phase start.
- **HNSW on an empty table:** fine in Postgres, but the round-trip test should `set hnsw.ef_search` explicitly so results are deterministic.
- **FTS language:** `english` is hard-coded. Note it as a limitation, not a config option.
