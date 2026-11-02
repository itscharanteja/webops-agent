-- Usage: psql -U postgres -d webops -v owner_id=YOUR_AUTH_USER_UUID -f tests/fixtures/seed_project.sql
insert into projects (owner_id, name, base_url, approved_origins, crawl_defaults, approval_user_id, approved_at)
select
  :'owner_id'::uuid, 'Local fixture', 'http://localhost:8080/index.html',
  array['http://localhost:8080'],
  '{"maxPages":25,"maxDepth":3,"concurrency":2,"navigationTimeoutMs":10000,"pageTimeoutMs":60000,"scanTimeoutMs":900000,"requestsPerSecond":2}'::jsonb,
  :'owner_id'::uuid, now()
where not exists (select 1 from projects where owner_id = :'owner_id'::uuid and name = 'Local fixture');
insert into project_members (project_id, user_id, role)
select id, :'owner_id'::uuid, 'owner' from projects where owner_id = :'owner_id'::uuid and name = 'Local fixture'
on conflict do nothing;
