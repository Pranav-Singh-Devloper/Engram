-- Fix for 0004: Postgres raises "value out of range: underflow" when exp()
-- of a large negative number underflows a double, instead of returning 0. A
-- fact untouched for ~745·τ days (about 28 years in the working tier, or one
-- simulated far-future sweep) made every sweep fail. Exponents are clamped at
-- -700, where exp() is ~1e-304: zero for scoring, and the TS mirror agrees.
-- access_score is a real (float4) column, which underflows below ~1e-38, so a
-- decayed value under 1e-30 is stored as 0.
create or replace function engram.engram_decay_sweep(
  p_now                 timestamptz,
  p_tau_working_days    double precision,
  p_tau_long_term_days  double precision,
  p_threshold           double precision,
  p_w_recency           double precision,
  p_w_access            double precision,
  p_w_importance        double precision,
  p_access_saturation   double precision,
  p_static_predicates   text[],
  p_namespace           uuid default null
) returns integer
language plpgsql
as $$
declare
  v_archived integer;
begin
  -- Time since the previous sweep that covered each namespace (0 on the first).
  drop table if exists pg_temp.sweep_scope;
  create temporary table sweep_scope on commit drop as
  select n.id as namespace_id,
         greatest(0, extract(epoch from (p_now - coalesce(
           (select max(s.ran_at) from engram.decay_sweeps s
             where s.ran_at <= p_now and (s.namespace_id is null or s.namespace_id = n.id)),
           p_now))) / 86400.0) as dt_days
  from engram.namespaces n
  where p_namespace is null or n.id = p_namespace;

  -- access_score ← access_score · exp(−Δt / τ_tier), current beliefs only.
  update engram.facts f
     set access_score = case
           when f.access_score * exp(greatest(-700, -sc.dt_days /
                  case when f.tier = 'long_term' then p_tau_long_term_days else p_tau_working_days end)) < 1e-30
           then 0
           else f.access_score * exp(-sc.dt_days /
                  case when f.tier = 'long_term' then p_tau_long_term_days else p_tau_working_days end)
           end
    from sweep_scope sc
   where f.namespace_id = sc.namespace_id
     and f.invalidated_at is null and f.access_score > 0 and sc.dt_days > 0;

  -- Archive current, non-exempt beliefs whose retention fell below θ.
  with doomed as (
    select f.id, f.namespace_id
      from engram.facts f
      join sweep_scope sc on sc.namespace_id = f.namespace_id
      join engram.entities subj on subj.id = f.subject_id
     where f.invalidated_at is null
       and f.recorded_at <= p_now
       and f.tier <> 'archived'
       and not f.pinned
       and not (f.predicate = any(p_static_predicates))
       and not (subj.is_self and f.predicate = 'is_named')
       and (
         p_w_recency * exp(greatest(-700, -greatest(0, extract(epoch from (p_now - coalesce(f.last_accessed_at, f.recorded_at))) / 86400.0)
           / case when f.tier = 'long_term' then p_tau_long_term_days else p_tau_working_days end))
         + p_w_access * least(1, ln(1 + f.access_score) / ln(1 + p_access_saturation))
         + p_w_importance * f.importance
       ) < p_threshold
  ),
  archived as (
    update engram.facts f set tier = 'archived'
      from doomed d where f.id = d.id
    returning f.id, f.namespace_id
  )
  insert into engram.fact_revisions (namespace_id, old_fact_id, new_fact_id, kind, resolver, reason, created_at)
  select namespace_id, id, id, 'archive', 'decay', 'retention fell below the archive threshold', p_now
    from archived;
  get diagnostics v_archived = row_count;

  insert into engram.decay_sweeps (namespace_id, ran_at, archived) values (p_namespace, p_now, v_archived);
  return v_archived;
end;
$$;
