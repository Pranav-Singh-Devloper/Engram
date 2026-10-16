-- Supabase-only: these roles don't exist on a plain Postgres. Applied by
-- `pnpm db:migrate:hosted`, never locally (SPEC §3, §5).
--
-- Supabase's REST API runs as `anon` or `authenticated`, and the anon key is
-- public by design. Without USAGE on the schema those roles can't reach any
-- object in it, whatever the object-level grants say; that's the control
-- that matters. The object-level revokes below are defense in depth.
revoke all on schema engram from anon, authenticated;

revoke all on all tables in schema engram from anon, authenticated;
revoke all on all sequences in schema engram from anon, authenticated;
-- Functions are executable by PUBLIC by default, and every role is in PUBLIC.
revoke all on all functions in schema engram from anon, authenticated, public;

-- Objects created later by the migrating role start out revoked too.
alter default privileges in schema engram revoke all on tables from anon, authenticated;
alter default privileges in schema engram revoke all on sequences from anon, authenticated;
alter default privileges in schema engram revoke all on functions from anon, authenticated, public;
