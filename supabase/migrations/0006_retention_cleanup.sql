-- Phase 5: artifact retention cleanup functions
create or replace function app.get_expired_evidence_artifacts(p_limit int default 500)
returns table (id uuid, scan_id uuid, object_key text)
language sql security definer set search_path = public, pg_temp as $$
  select id, scan_id, object_key from evidence
  where retained_until <= now() and object_key is not null
  limit p_limit;
$$;

create or replace function app.mark_evidence_artifacts_purged(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  update evidence set object_key = null where id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function app.get_expired_evidence_artifacts(int) from public;
revoke all on function app.mark_evidence_artifacts_purged(uuid[]) from public;
grant execute on function app.get_expired_evidence_artifacts(int) to webops_worker;
grant execute on function app.mark_evidence_artifacts_purged(uuid[]) to webops_worker;
