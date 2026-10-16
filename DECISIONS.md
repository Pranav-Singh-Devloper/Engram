# Decisions

Short ADRs, append-only. When a decision changes, add a new entry that supersedes the old one and mark the old one `Superseded by ADR-NNN`; don't edit or delete history.

---

## ADR-001 — TypeScript monorepo with a hand-built engine

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** The project exists to show memory internals: conflict resolution, bitemporal validity, decay, consolidation. Graphiti, Mem0 and similar engines would hide exactly those parts, and Graphiti adds a Python service plus a graph database.

**Decision.** A single-language pnpm workspace (TS strict), with the engine hand-built on Postgres + pgvector (SPEC §2). Graphiti stays a documented alternative (SPEC Appendix B). TypeScript is pinned to 6.0 because typescript-eslint doesn't support the 7.x native compiler yet.

**Consequences.** Engine, MCP server, web app and bench share types. We own the correctness of the temporal model, which is why its tests come first (SPEC §16).

---

## ADR-002 — Docker pgvector for dev and CI, Supabase for hosting

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** Everything must run on free tiers. The local Supabase stack needs several GB of images on a disk with little free space, and tests should run offline. pg_cron, the only Supabase-specific feature, is needed only for scheduling on the hosted database.

**Decision.** Local dev and CI use the plain `pgvector/pgvector:0.8.7-pg17` image (pg17 matches new Supabase projects). SQL is split in two: `supabase/migrations/` is portable and applied everywhere, and `supabase/hosted/` (pg_cron schedules, role revokes) is applied only by `pnpm db:migrate:hosted`. The runner refuses to apply hosted SQL to a local URL or to reset a remote one. Migrations run one file per transaction under `pg_advisory_xact_lock`, with checksums so an applied file can't be edited.

**Consequences.** Decay and cleanup are SQL functions tested locally with a simulated clock; only their schedules are hosted-only and verified at deploy (P10). A homegrown runner replaces the Supabase CLI, roughly 100 lines with its own tests.

---

## ADR-003 — An unexposed `engram` schema

**Date:** 2026-10-16 · **Status:** Accepted

**Context.** Supabase serves the `public` schema over its REST API, and the anon key is public by design. Tables in `public` without row-level security would let anyone with the project URL read every stored memory.

**Decision.** All Engram objects live in an `engram` schema, which isn't in the API's exposed schemas; extensions live in `extensions` on every target. `supabase/hosted/0001_revoke_api_roles.sql` revokes schema usage and object privileges from `anon` and `authenticated` (and function execute from `PUBLIC`). Clients always set `search_path = engram, extensions, public` per connection.

**Consequences.** The app connects only through `DATABASE_URL`, so this costs nothing in code. Any future hosted migration that creates objects should be followed by a check that anon REST calls still fail (P10 verification).
