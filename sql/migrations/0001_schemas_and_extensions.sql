-- Engram lives in its own schema, never in `public`, which Supabase serves
-- over its REST API (SPEC §5). Extensions get their own schema on every
-- target so local and hosted databases have the same layout.
create schema if not exists extensions;
create schema if not exists engram;

create extension if not exists vector with schema extensions;

-- gen_random_uuid() is built in since Postgres 13, so pgcrypto isn't needed.

-- A convenience for psql sessions. Every Engram client also sets search_path
-- per connection, so a hosted database that refuses this loses nothing.
do $$
begin
  execute format(
    'alter database %I set search_path = engram, extensions, public',
    current_database()
  );
exception when insufficient_privilege then
  raise notice 'skipping database-level search_path: %', sqlerrm;
end
$$;
