-- Run with psql -v ON_ERROR_STOP=1 as migration owner against a disposable DB.
set role webops_app;
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
insert into projects (owner_id, name, base_url, approved_origins, crawl_defaults, approval_user_id, approved_at)
values (
  '11111111-1111-4111-8111-111111111111', 'RLS owner A', 'https://example.com/',
  array['https://example.com'], '{}'::jsonb, '11111111-1111-4111-8111-111111111111', now()
) returning id as project_id \gset
insert into project_members (project_id, user_id, role)
values (:'project_id'::uuid, '11111111-1111-4111-8111-111111111111', 'owner');
select 1 / (case when count(*) = 1 then 1 else 0 end) from projects where id = :'project_id'::uuid;

reset role;
insert into scans (project_id, status, config_snapshot)
values (:'project_id'::uuid, 'queued', '{}'::jsonb) returning id as scan_id \gset
insert into scan_pages (scan_id, normalized_url, depth)
values (:'scan_id'::uuid, 'https://example.com/', 0) returning id as page_id \gset
insert into scan_events (scan_id, seq, level, phase, message)
values (:'scan_id'::uuid, 1, 'info', 'test', 'Started');
insert into evidence (scan_id, page_id, kind, captured_at, payload, idempotency_key)
values (:'scan_id'::uuid, :'page_id'::uuid, 'url', now(), '{}'::jsonb, 'test-proof') returning id as evidence_id \gset
insert into issues (project_id, fingerprint, title, description, priority, status, first_seen, last_seen)
values (:'project_id'::uuid, 'test-fingerprint', 'Test issue', 'Test description', 'P3', 'open', now(), now()) returning id as issue_id \gset
insert into issue_observations (issue_id, scan_id, page_id, fingerprint, rule_id, rule_version, detected_severity, confidence, facts, explanation_snapshot)
values (:'issue_id'::uuid, :'scan_id'::uuid, :'page_id'::uuid, 'test-fingerprint', 'TEST', '1', 'P3', 1, '{}'::jsonb, '{}'::jsonb) returning id as observation_id \gset
insert into observation_evidence (observation_id, evidence_id, citation_order, label)
values (:'observation_id'::uuid, :'evidence_id'::uuid, 0, 'Test proof');
insert into issue_revisions (issue_id, editor_id, old_values, new_values, version)
values (:'issue_id'::uuid, '11111111-1111-4111-8111-111111111111', '{}'::jsonb, '{}'::jsonb, 1);
insert into reports (scan_id, summary, coverage, issue_snapshot)
values (:'scan_id'::uuid, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);

set role webops_app;
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
select 1 / (case when count(*) = 1 then 1 else 0 end) from scans where id = :'scan_id'::uuid;
select 1 / (case when count(*) = 1 then 1 else 0 end) from evidence where id = :'evidence_id'::uuid;
select 1 / (case when count(*) = 1 then 1 else 0 end) from reports where scan_id = :'scan_id'::uuid;

select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', false);
select 1 / (case when count(*) = 0 then 1 else 0 end) from projects where id = :'project_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from project_members where project_id = :'project_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from scans where id = :'scan_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from scan_pages where scan_id = :'scan_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from scan_events where scan_id = :'scan_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from evidence where id = :'evidence_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from issues where project_id = :'project_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from issue_observations where issue_id = :'issue_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from observation_evidence where observation_id = :'observation_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from issue_revisions where issue_id = :'issue_id'::uuid;
select 1 / (case when count(*) = 0 then 1 else 0 end) from reports where scan_id = :'scan_id'::uuid;
select 1 / (case when not has_table_privilege('webops_app', 'scans', 'INSERT') then 1 else 0 end);
