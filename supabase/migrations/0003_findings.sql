-- Phase 3: scanner-owned proof and observations; member-scoped board edits.
alter table scans add column browser_version text;
create index if not exists issues_fingerprint_idx on issues(project_id, fingerprint);
create index if not exists evidence_page_kind_idx on evidence(scan_id, page_id, kind);
create index if not exists observations_fingerprint_idx on issue_observations(scan_id, fingerprint);

grant select, insert on evidence to webops_worker;
grant select, insert, update(last_seen, not_seen) on issues to webops_worker;
grant select, insert on issue_observations to webops_worker;
grant select, insert on observation_evidence to webops_worker;
grant update(issue_snapshot, summary) on reports to webops_worker;
grant update(browser_version) on scans to webops_worker;

create policy worker_evidence_read on evidence for select to webops_worker
  using (scan_id = app.current_scan_id());
create policy worker_evidence_write on evidence for insert to webops_worker
  with check (scan_id = app.current_scan_id());
create policy worker_issues_read on issues for select to webops_worker
  using (project_id = (select project_id from scans where id = app.current_scan_id()));
create policy worker_issues_write on issues for insert to webops_worker
  with check (project_id = (select project_id from scans where id = app.current_scan_id()));
create policy worker_issues_update on issues for update to webops_worker
  using (project_id = (select project_id from scans where id = app.current_scan_id()))
  with check (project_id = (select project_id from scans where id = app.current_scan_id()));
create policy worker_observations_read on issue_observations for select to webops_worker
  using (scan_id = app.current_scan_id());
create policy worker_observations_write on issue_observations for insert to webops_worker
  with check (scan_id = app.current_scan_id());
create policy worker_citations_read on observation_evidence for select to webops_worker
  using (exists (select 1 from issue_observations o where o.id = observation_id and o.scan_id = app.current_scan_id()));
create policy worker_citations_write on observation_evidence for insert to webops_worker
  with check (exists (select 1 from issue_observations o where o.id = observation_id and o.scan_id = app.current_scan_id()));
create policy worker_reports_update on reports for update to webops_worker
  using (scan_id = app.current_scan_id()) with check (scan_id = app.current_scan_id());

grant update(title, description, priority, status, version, updated_at) on issues to webops_app;
grant insert on issue_revisions to webops_app;
create policy issues_edit on issues for update to webops_app
  using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy revisions_edit on issue_revisions for insert to webops_app
  with check (editor_id = app.current_user_id() and exists
    (select 1 from issues i where i.id = issue_id and app.can_edit_project(i.project_id)));
