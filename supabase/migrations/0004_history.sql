-- Phase 4: report rows cannot drift after terminal commit.
revoke update(issue_snapshot, summary) on reports from webops_worker;
drop policy if exists worker_reports_update on reports;

create or replace function app.reject_report_update() returns trigger
language plpgsql as $$
begin
  raise exception 'Historical reports are immutable';
end $$;
create trigger reports_immutable before update on reports
  for each row execute function app.reject_report_update();

grant update(explanation_snapshot) on issue_observations to webops_worker;
create policy worker_observations_enrich on issue_observations for update to webops_worker
  using (scan_id = app.current_scan_id() and exists
    (select 1 from scans s where s.id = scan_id and s.status = 'running'))
  with check (scan_id = app.current_scan_id() and exists
    (select 1 from scans s where s.id = scan_id and s.status = 'running'));
