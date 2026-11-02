-- Narrow, scan-scoped function: the worker can derive coverage across earlier
-- reports without receiving general read access to other scans.
create or replace function app.mark_not_seen_for_completed_scan(p_scan uuid, p_visited_urls text[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_previous text[];
  v_count integer;
begin
  if p_scan is distinct from app.current_scan_id() then
    raise exception 'Worker scan scope denied';
  end if;
  select project_id into v_project from scans where id = p_scan and status = 'completed';
  if v_project is null then
    raise exception 'Scan is not completed';
  end if;
  select array(select jsonb_array_elements_text(r.coverage->'visitedUrls')) into v_previous
    from reports r join scans s on s.id = r.scan_id
    where s.project_id = v_project and s.id <> p_scan and s.status = 'completed'
    order by s.finished_at desc, s.id desc limit 1;
  if v_previous is null or not (v_previous <@ p_visited_urls) then
    return null;
  end if;
  update issues i set not_seen = true
    where i.project_id = v_project and not i.not_seen
      and exists (select 1 from issue_observations o join scan_pages p on p.id = o.page_id
                  where o.issue_id = i.id and p.normalized_url = any(p_visited_urls))
      and not exists (select 1 from issue_observations o where o.issue_id = i.id and o.scan_id = p_scan);
  select count(*) into v_count from issues where project_id = v_project and not_seen;
  return v_count;
end $$;
revoke all on function app.mark_not_seen_for_completed_scan(uuid, text[]) from public;
grant execute on function app.mark_not_seen_for_completed_scan(uuid, text[]) to webops_worker;
