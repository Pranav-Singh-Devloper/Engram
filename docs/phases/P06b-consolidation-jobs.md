# P06b — Consolidation + jobs

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Add the "sleep" phase. Episodes are clustered and summarized, their candidates are fed back through the normal write path with provenance-aware merging, and confirmed facts are promoted to `long_term`. The job is scheduled from GitHub Actions; decay and demo cleanup are scheduled with pg_cron on the hosted database.

## Spec refs
§8 (consolidation), §6.4 (background jobs), §7.2.3 (provenance-aware merge), §3 (database targets; `supabase/hosted/`), §14 (keep-alive note), §15 P6.

## Depends on
P06a: decay function, purge. Summary regeneration on purge is completed here.

## Definition of done
- [ ] Clustering of unconsolidated `turn` episodes by namespace, session, shared entities and embedding proximity. Sessions with ≥12 unconsolidated episodes are prioritized.
- [ ] `summarize()` prompt and Gemini implementation produce fact candidates plus a `summary` episode with `summarizes` set. Source episodes are marked `consolidated`.
- [ ] Candidates go through P02/P03 unchanged. The provenance-aware merge test proves that re-extracted facts are confirmed, not double-counted.
- [ ] Consolidation is the only path into `long_term` (asserted).
- [ ] `pnpm jobs:consolidate` runs end-to-end against the local Docker DB.
- [ ] `.github/workflows/consolidate.yml` runs nightly and on manual dispatch with `DATABASE_URL` set from the `HOSTED_DATABASE_URL` secret. Without the secret it skips cleanly.
- [ ] `supabase/hosted/0002_cron_schedules.sql` schedules the daily decay sweep and the hourly demo-namespace cleanup. It is applied only by `db:migrate:hosted`, and the local runner never sees it.
- [ ] The demo-cleanup SQL function itself is portable and tested locally.
- [ ] Purge now regenerates affected summaries instead of deleting them.

## Risks and verify-at-build-time
- **Verify:** pg_cron availability and syntax on the current Supabase free tier (`cron.schedule`), and the schema pg_cron must be created in.
- **The keep-alive depends on the nightly workflow running.** GitHub disables schedules after 60 days of repo inactivity. Document re-enabling it in the README (P10).
- **Quota:** consolidation is the main recurring Gemini cost on the hosted demo. Cap clusters per run.
