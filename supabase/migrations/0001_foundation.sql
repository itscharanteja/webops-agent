-- Apply as a migration owner, then connect the API as webops_app.
create extension if not exists pgcrypto;
create schema if not exists app;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'webops_app') then
    create role webops_app nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end $$;

create or replace function app.current_user_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  base_url text not null,
  approved_origins text[] not null check (cardinality(approved_origins) between 1 and 10),
  crawl_defaults jsonb not null,
  approval_user_id uuid not null,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members(user_id, project_id);

create or replace function app.project_role(p_project_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select 'owner' from projects where id = p_project_id and owner_id = app.current_user_id()),
    (select role from project_members where project_id = p_project_id and user_id = app.current_user_id())
  )
$$;
create or replace function app.can_read_project(p_project_id uuid) returns boolean
language sql stable as $$ select app.project_role(p_project_id) is not null $$;
create or replace function app.can_edit_project(p_project_id uuid) returns boolean
language sql stable as $$ select app.project_role(p_project_id) in ('owner', 'editor') $$;

create table scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  config_snapshot jsonb not null,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  visited_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error text,
  scanner_version text,
  check_version text
);
create index scans_project_queued_idx on scans(project_id, queued_at desc);
create index scans_status_idx on scans(status);

create table scan_pages (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  normalized_url text not null,
  final_url text,
  depth integer not null check (depth >= 0),
  http_status integer,
  title text,
  timing_ms integer,
  visited_at timestamptz,
  unique (scan_id, normalized_url)
);
create index scan_pages_scan_idx on scan_pages(scan_id);

create table scan_events (
  scan_id uuid not null references scans(id) on delete cascade,
  seq bigint not null check (seq > 0),
  at timestamptz not null default now(),
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  phase text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (scan_id, seq)
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  page_id uuid references scan_pages(id),
  kind text not null check (kind in ('screenshot', 'dom', 'console', 'network', 'url')),
  captured_at timestamptz not null,
  locator text,
  payload jsonb not null,
  object_key text,
  checksum text,
  mime_type text,
  retained_until timestamptz,
  verified boolean not null default false,
  idempotency_key text not null,
  unique (scan_id, idempotency_key)
);
create index evidence_scan_idx on evidence(scan_id);

create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  fingerprint text not null,
  title text not null,
  description text not null,
  priority text not null check (priority in ('P0', 'P1', 'P2', 'P3')),
  status text not null check (status in ('open', 'in_progress', 'resolved', 'wont_fix')),
  version integer not null default 1 check (version > 0),
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  not_seen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, fingerprint)
);
create index issues_project_status_idx on issues(project_id, status, priority);
create index issues_project_last_seen_idx on issues(project_id, last_seen desc);

create table issue_observations (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  scan_id uuid not null references scans(id) on delete cascade,
  page_id uuid not null references scan_pages(id),
  fingerprint text not null,
  rule_id text not null,
  rule_version text not null,
  detected_severity text not null check (detected_severity in ('P0', 'P1', 'P2', 'P3')),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  facts jsonb not null,
  explanation_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (scan_id, fingerprint, page_id)
);
create index issue_observations_issue_idx on issue_observations(issue_id, created_at desc);
create index issue_observations_scan_idx on issue_observations(scan_id);

create table observation_evidence (
  observation_id uuid not null references issue_observations(id) on delete cascade,
  evidence_id uuid not null references evidence(id),
  citation_order integer not null check (citation_order >= 0),
  label text not null,
  primary key (observation_id, evidence_id),
  unique (observation_id, citation_order)
);

create table issue_revisions (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  editor_id uuid not null,
  at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null,
  change_reason text,
  version integer not null,
  unique (issue_id, version)
);
create index issue_revisions_issue_idx on issue_revisions(issue_id, at desc);

create table reports (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references scans(id) on delete cascade,
  summary jsonb not null,
  coverage jsonb not null,
  issue_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- Browser-facing reads are member-scoped. All scan writes are performed by a
-- separate worker service role in later phases; the API role has no access.
alter table projects enable row level security;
alter table project_members enable row level security;
alter table scans enable row level security;
alter table scan_pages enable row level security;
alter table scan_events enable row level security;
alter table evidence enable row level security;
alter table issues enable row level security;
alter table issue_observations enable row level security;
alter table observation_evidence enable row level security;
alter table issue_revisions enable row level security;
alter table reports enable row level security;

create policy projects_read on projects for select using (owner_id = app.current_user_id() or app.can_read_project(id));
create policy projects_create on projects for insert with check (owner_id = app.current_user_id() and approval_user_id = app.current_user_id());
create policy projects_update on projects for update using (app.project_role(id) = 'owner') with check (app.project_role(id) = 'owner');
create policy members_read on project_members for select using (app.can_read_project(project_id));
create policy members_create on project_members for insert with check (app.project_role(project_id) = 'owner');
create policy scans_read on scans for select using (app.can_read_project(project_id));
create policy pages_read on scan_pages for select using (exists (select 1 from scans where scans.id = scan_id and app.can_read_project(scans.project_id)));
create policy events_read on scan_events for select using (exists (select 1 from scans where scans.id = scan_id and app.can_read_project(scans.project_id)));
create policy evidence_read on evidence for select using (exists (select 1 from scans where scans.id = scan_id and app.can_read_project(scans.project_id)));
create policy issues_read on issues for select using (app.can_read_project(project_id));
create policy observations_read on issue_observations for select using (exists (select 1 from issues where issues.id = issue_id and app.can_read_project(issues.project_id)));
create policy citations_read on observation_evidence for select using (exists (select 1 from issue_observations o join issues i on i.id = o.issue_id where o.id = observation_id and app.can_read_project(i.project_id)));
create policy revisions_read on issue_revisions for select using (exists (select 1 from issues where issues.id = issue_id and app.can_read_project(issues.project_id)));
create policy reports_read on reports for select using (exists (select 1 from scans where scans.id = scan_id and app.can_read_project(scans.project_id)));

grant usage on schema public, app to webops_app;
grant select, insert, update on projects to webops_app;
grant select, insert on project_members to webops_app;
grant select on scans, scan_pages, scan_events, evidence, issues, issue_observations, observation_evidence, issue_revisions, reports to webops_app;
grant execute on all functions in schema app to webops_app;
