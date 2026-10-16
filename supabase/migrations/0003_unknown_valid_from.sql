-- A fact can end at a known time without a stated start ("before that, I
-- lived in Marseille"). Its valid_from is -infinity and its source 'unknown';
-- the canonical as-of query needs no change, since -infinity <= T for any T.
alter table engram.facts drop constraint facts_valid_from_source_check;
alter table engram.facts add constraint facts_valid_from_source_check
  check (valid_from_source in ('explicit', 'episode', 'unknown'));
alter table engram.facts add constraint facts_unknown_start_check
  check ((valid_from_source = 'unknown') = (valid_from = '-infinity'));
