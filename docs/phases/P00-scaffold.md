# P00 — Scaffold

**Status:** done (2026-10-16)

## Goal
Set up an empty but fully wired monorepo. A fresh clone should install, start a local pgvector database, apply migrations, and pass typecheck, test and lint, both locally and in CI. This phase also decides the database layout every later phase builds on: the `engram` schema and the split between `migrations/` and `hosted/`.

## Spec refs
§2, §3 (database targets), §4 (layout and tooling), §5 (schemas and hosted exposure), §14 (free stack, secrets), §15 P0, §16 (conventions, attribution).

## Depends on / unlocks
- **Depends on:** nothing.
- **Unlocks:** P01. Every later phase uses the runner, the DB scripts and CI from here.

## Scope
**In**
- pnpm workspace, TS strict, vitest, eslint + prettier.
- `docker-compose.yml` with the `pgvector/pgvector` image.
- A plain-SQL migration runner with a tracking table.
- `db:up`, `db:down`, `db:reset`, `db:migrate`, `db:migrate:hosted`.
- Migration 0001: the `extensions` and `engram` schemas, and pgvector.
- `supabase/hosted/` holding the revoke SQL. The pg_cron SQL is added in P06b.
- `.env.example`, CI workflow, local agent settings, `DECISIONS.md`.
- `packages/core` skeleton with one trivial test.

**Out**
- Tables (P01).
- Providers (P01).
- `packages/mcp` and `apps/web` (P07, P09). They are not created yet, to avoid empty packages that can rot.

## Deliverables
```
package.json                     # root scripts: typecheck, test, lint, format, db:*
pnpm-workspace.yaml              # packages/*, apps/*, bench
tsconfig.base.json               # strict, noUncheckedIndexedAccess, ES2022, NodeNext
eslint.config.mjs                # typescript-eslint flat config
.prettierrc, .prettierignore
.node-version                    # current Node LTS (verify)
.env.example                     # DATABASE_URL=postgres://engram:engram@localhost:54329/engram, other keys blank
docker-compose.yml               # pgvector/pgvector:pg17 (verify tag), port 54329, named volume, healthcheck
scripts/migrate.ts               # runner (see Tasks)
supabase/migrations/0001_schemas_and_extensions.sql
supabase/hosted/0001_revoke_api_roles.sql
packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/index.test.ts}
.github/workflows/ci.yml
DECISIONS.md                     # ADR-001..003
.claude/settings.json            # local only, gitignored: attribution off
```

## Tasks
1. **Workspace + tooling.**
   - Root `package.json` with `"packageManager"` pinned.
   - `pnpm-workspace.yaml`, `tsconfig.base.json`, eslint and prettier configs.
   - `packages/core` with one export and one passing test.
   - Root scripts: `typecheck`, `test`, `lint`, `format` (all `pnpm -r`).
2. **Local database.**
   - `docker-compose.yml` with pgvector on a non-default port (54329), so it can't collide with a local Postgres.
   - A healthcheck, and a named volume.
   - `db:up` runs `docker compose up -d --wait`. `db:down` stops it.
3. **Migration runner (`scripts/migrate.ts`).**
   - Reads `supabase/migrations/*.sql` in lexical order.
   - Records each applied file in `engram.schema_migrations(filename, checksum, applied_at)`.
   - Fails loudly if an already-applied file's checksum changes.
   - Runs each file in its own transaction.
   - `--hosted` additionally applies `supabase/hosted/*.sql` with the same tracking, after the portable migrations. It is only meant for `HOSTED_DATABASE_URL`, and refuses to run against a URL on `localhost`.
   - `db:reset` drops and recreates the `engram` schema, then migrates. Local only: it refuses non-localhost URLs.
4. **Migration 0001.**
   - `create schema extensions`, `create schema engram`, `create extension vector with schema extensions`.
   - `alter database ... set search_path = engram, extensions, public`. The client also sets it per connection, in case the database-level setting is unavailable on the hosted side.
   - `create extension pgcrypto` only if `gen_random_uuid()` is missing (it is built in from PG13, so probably not needed).
5. **Hosted SQL.** `supabase/hosted/0001_revoke_api_roles.sql` revokes all on schema `engram` (and all tables, sequences and functions in it) from `anon` and `authenticated`. It also sets default privileges so future objects stay revoked. It never runs locally.
6. **CI (`.github/workflows/ci.yml`).**
   - On push and PR.
   - A pgvector service container on the same image and tag as compose.
   - pnpm cache, then `pnpm install --frozen-lockfile`, `pnpm db:migrate`, typecheck, test, lint.
7. **Conventions.**
   - `.claude/settings.json` (gitignored): `{"attribution": {"commit": "", "pr": ""}, "includeCoAuthoredBy": false}`.
   - Local `CLAUDE.md` from spec Appendix A (gitignored).
   - `DECISIONS.md`:
     - ADR-001: TypeScript monorepo, hand-built engine.
     - ADR-002: Docker pgvector for dev/CI and Supabase for hosting; the `migrations/` vs `hosted/` split.
     - ADR-003: the `engram` schema plus revokes, so the Supabase REST API can't reach memories.
8. **Fresh-clone check.** Clone into the scratchpad, then run `pnpm install && pnpm db:up && pnpm db:migrate && pnpm -r typecheck && pnpm -r test && pnpm -r lint`.

## Tests
- `packages/core/src/index.test.ts`: a trivial export test, so the test pipeline is real.
- `scripts/migrate.int.test.ts`:
  - applies 0001 to a scratch schema;
  - re-running is a no-op;
  - a modified checksum fails;
  - `--hosted` refuses a localhost URL;
  - `db:reset` refuses a non-localhost URL.
- A smoke query that `select '[1,2,3]'::vector` works with the configured `search_path`.

## Definition of done
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r lint` is green locally.
- [x] The same is green in GitHub Actions on `main`.
- [x] A fresh clone boots: install, `db:up`, `db:migrate` and the gates all pass with no manual steps beyond copying `.env.example`.
- [x] Re-running `db:migrate` is a no-op, and a changed applied migration fails.
- [x] ADR-001 to ADR-003 are written.
- [x] `git log --format='%an <%ae>' | sort -u` shows one identity, and there are no attribution trailers.

## Planned commits
1. `chore: scaffold pnpm workspace with strict typescript`
2. `chore: add eslint, prettier and vitest`
3. `chore(db): add local pgvector database via docker compose`
4. `feat(db): add sql migration runner with hosted-only split`
5. `feat(db): create engram schema and enable pgvector`
6. `chore(ci): run gates against a pgvector service container`
7. `docs: record initial architecture decisions`

## Free-tier notes
- Everything is local or GitHub Actions. Actions minutes are free for public repos; keep the repo public, or watch the private-repo minute cap.
- Disk: the image is about 400 MB. Don't pull the full Supabase CLI stack.

## Risks and verify-at-build-time
- **Proposed dependencies** (approve at phase start):
  - `typescript`, `@types/node`: required.
  - `vitest`: spec tooling.
  - `eslint`, `typescript-eslint`, `prettier`: spec tooling.
  - `tsx`: run TS scripts without a build step.
  - `postgres` (postgres.js): tagged-template SQL, built-in transactions, and a `prepare: false` option for Supabase's transaction pooler. Chosen now because the runner needs a client. The P01 repositories reuse it.
- **Verify:** current Node LTS; the `pgvector/pgvector` tag that matches Supabase's Postgres major; current eslint flat-config and typescript-eslint setup.
- **Hosted `search_path`:** Supabase may restrict `alter database`. The client-side `search_path` option (postgres.js `connection: { search_path }`) is the fallback, so make sure the client always sets it.
- **Port clash:** document overriding the port via `ENGRAM_DB_PORT` if 54329 is taken.

## Summary

Done 2026-10-16. Workspace, local pgvector DB, migration runner with the `migrations/` vs `hosted/` split, migration 0001, hosted revokes, CI and ADR-001 to ADR-003 are in place. 27 tests; CI green on `main`; the fresh-clone check passed.

Deviations from the plan above:
- **`scripts/` is a workspace package** (`@engram/scripts`), so `pnpm -r` gates cover it. Tests are `db.test.ts` (target-safety rules), `migrator.int.test.ts` (runner, including a concurrent-runner test that was mutation-checked) and `schema.int.test.ts` (real migrations; hosted revokes checked by creating `anon`/`authenticated` inside a rolled-back transaction).
- **Versions:**
  - TypeScript is pinned to 6.0 (typescript-eslint caps at `<6.1`; TS 7 is the native port).
  - vitest is 5.0.4, because pnpm 11's minimum-release-age gate rejected 5.0.5.
  - Node stays on 22 (installed locally; still LTS).
- **pnpm 11 blocks install scripts:** `allowBuilds: esbuild: false`. tsx and vite work without esbuild's postinstall.
- **The image is 656 MB unpacked**, not ~400 MB. Free disk was about 6 GB afterwards.
- **pgcrypto isn't needed:** `gen_random_uuid()` is built in.
- **Prettier ignores `docs/`**, so the spec isn't reflowed.

Follow-ups for P01:
- `packages/core/src/db/client.ts` should reuse the `scripts/db.ts` pattern (always set `search_path`, SSL off only for local). Move the shared bits into core, and have `scripts` depend on `@engram/core`.
