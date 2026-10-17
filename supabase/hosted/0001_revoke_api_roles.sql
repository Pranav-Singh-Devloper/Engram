-- Hosted-only: applied by `pnpm db:migrate:hosted`, never locally (SPEC §3, §5).
--
-- Supabase's REST API runs as `anon` or `authenticated`, and the anon key is
-- public by design. Without USAGE on the schema those roles can't reach any
-- object in it, whatever the object-level grants say; that's the control
-- that matters. The object-level revokes are defense in depth. Neon (the
-- current host, ADR-014) has no such roles and no REST API unless it's
-- switched on, so the role revokes run only where the roles exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema engram from anon, authenticated;
    revoke all on all tables in schema engram from anon, authenticated;
    revoke all on all sequences in schema engram from anon, authenticated;
    revoke all on all functions in schema engram from anon, authenticated;
    alter default privileges in schema engram revoke all on tables from anon, authenticated;
    alter default privileges in schema engram revoke all on sequences from anon, authenticated;
    alter default privileges in schema engram revoke all on functions from anon, authenticated;
  end if;
end $$;

-- Functions are executable by PUBLIC by default, and every role is in PUBLIC.
revoke all on all functions in schema engram from public;
alter default privileges in schema engram revoke all on functions from public;
