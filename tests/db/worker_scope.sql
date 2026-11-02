-- Run after both migrations as a migration owner against a disposable DB.
insert into projects (owner_id, name, base_url, approved_origins, crawl_defaults, approval_user_id, approved_at)
values ('11111111-1111-4111-8111-111111111111', 'Worker scope A', 'https://example.com/', array['https://example.com'], '{}'::jsonb,
        '11111111-1111-4111-8111-111111111111', now()) returning id as project_a \gset
insert into projects (owner_id, name, base_url, approved_origins, crawl_defaults, approval_user_id, approved_at)
values ('22222222-2222-4222-8222-222222222222', 'Worker scope B', 'https://example.org/', array['https://example.org'], '{}'::jsonb,
        '22222222-2222-4222-8222-222222222222', now()) returning id as project_b \gset
insert into scans (project_id, status, config_snapshot) values (:'project_a'::uuid, 'queued', '{}'::jsonb) returning id as scan_a \gset
insert into scans (project_id, status, config_snapshot) values (:'project_b'::uuid, 'queued', '{}'::jsonb) returning id as scan_b \gset
set role webops_worker;
select set_config('app.scan_id', :'scan_a', false);
select 1 / (case when count(*) = 1 then 1 else 0 end) from scans;
select 1 / (case when count(*) = 1 then 1 else 0 end) from projects;
select 1 / (case when count(*) = 0 then 1 else 0 end) from scans where id = :'scan_b'::uuid;
with changed as (update scans set status = 'running' where id = :'scan_b'::uuid returning id)
select 1 / (case when count(*) = 0 then 1 else 0 end) from changed;
select 1 / (case when not has_column_privilege('webops_worker', 'scans', 'project_id', 'UPDATE') then 1 else 0 end);
