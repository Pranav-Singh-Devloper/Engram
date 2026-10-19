-- P09a, ADR-019: counters for limits that aren't per namespace, so they can't
-- live in rate_limits (keyed on namespace_id). The web demo uses two buckets:
-- demo-session creation per hashed client IP (the key is an HMAC of the day
-- and the IP, never the IP), and the global daily cap on demo chat turns.
-- Every update is a single atomic upsert; `jobs:maintain` prunes old windows.
create table engram.throttles (
  bucket        text not null,
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (bucket, key, window_start)
);
create index throttles_window_start on engram.throttles (window_start);
