-- Hosted-only (ADR-014). Neon's proxy drops the search_path startup parameter
-- the client sends, so unqualified names (every repository query) would miss
-- the engram schema. A database-level default applies to every new session,
-- direct or pooled. Takes effect on the next connection.
do $$
begin
  execute format('alter database %I set search_path = engram, extensions, public', current_database());
end $$;
