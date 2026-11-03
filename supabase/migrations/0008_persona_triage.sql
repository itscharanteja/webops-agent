-- Phase IDEA-003: Persona-Targeted Triage & Role-Specific Deliverables

-- 1. Add target_persona to issue_observations
alter table issue_observations
  add column if not exists target_persona text not null default 'frontend'
  check (target_persona in ('ui_ux', 'frontend', 'backend', 'content_seo'));

create index if not exists idx_observations_persona
  on issue_observations(target_persona);

-- 2. Add persona_deliverables to reports
alter table reports
  add column if not exists persona_deliverables jsonb not null default '{}'::jsonb;

-- 3. Add discord_webhooks configuration to projects
alter table projects
  add column if not exists discord_webhooks jsonb not null default '{}'::jsonb;

-- 4. Permissions for worker role and app role
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'webops_worker') then
    grant update(persona_deliverables) on reports to webops_worker;
  end if;
  if exists (select 1 from pg_roles where rolname = 'webops_app') then
    grant update(discord_webhooks) on projects to webops_app;
  end if;
end $$;
