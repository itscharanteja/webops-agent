do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'webops_worker') then
    create role webops_worker nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end $$;

create or replace function app.current_scan_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.scan_id', true), '')::uuid
$$;

alter table scans add column cancel_requested_at timestamptz;
alter table scan_pages add column console_messages jsonb not null default '{"v":1,"items":[]}'::jsonb;
alter table scan_pages add column failed_requests jsonb not null default '{"v":1,"items":[]}'::jsonb;
alter table scan_events add column idempotency_key text;
create unique index scan_events_key_idx on scan_events(scan_id, idempotency_key) where idempotency_key is not null;

create policy scans_create on scans for insert to webops_app
  with check (status = 'queued' and app.can_edit_project(project_id));
create policy scans_cancel on scans for update to webops_app
  using (app.can_edit_project(project_id))
  with check (app.can_edit_project(project_id));
create policy events_cancel on scan_events for insert to webops_app
  with check (exists (select 1 from scans s where s.id = scan_id and app.can_edit_project(s.project_id)));
create policy reports_queue_failure on reports for insert to webops_app
  with check (exists (select 1 from scans s where s.id = scan_id and s.status = 'failed' and app.can_edit_project(s.project_id)));

grant insert, update on scans to webops_app;
grant insert on scan_events to webops_app;
grant insert on reports to webops_app;

grant usage on schema public, app to webops_worker;
grant select on projects to webops_worker;
grant select, update(status, started_at, finished_at, visited_count, skipped_count, failed_count, error, scanner_version, check_version) on scans to webops_worker;
grant select, insert, update(final_url, http_status, title, timing_ms, visited_at, console_messages, failed_requests) on scan_pages to webops_worker;
grant select, insert on scan_events to webops_worker;
grant select, insert on reports to webops_worker;
grant execute on all functions in schema app to webops_worker;

create policy worker_projects_read on projects for select to webops_worker
  using (id = (select project_id from scans where scans.id = app.current_scan_id()));
create policy worker_scans_read on scans for select to webops_worker
  using (id = app.current_scan_id());
create policy worker_scans_update on scans for update to webops_worker
  using (id = app.current_scan_id()) with check (id = app.current_scan_id());
create policy worker_pages_read on scan_pages for select to webops_worker
  using (scan_id = app.current_scan_id());
create policy worker_pages_write on scan_pages for insert to webops_worker
  with check (scan_id = app.current_scan_id());
create policy worker_pages_update on scan_pages for update to webops_worker
  using (scan_id = app.current_scan_id()) with check (scan_id = app.current_scan_id());
create policy worker_events_read on scan_events for select to webops_worker
  using (scan_id = app.current_scan_id());
create policy worker_events_write on scan_events for insert to webops_worker
  with check (scan_id = app.current_scan_id());
create policy worker_reports_read on reports for select to webops_worker
  using (scan_id = app.current_scan_id());
create policy worker_reports_write on reports for insert to webops_worker
  with check (scan_id = app.current_scan_id());
