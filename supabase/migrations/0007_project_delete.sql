-- Allow project owners to delete their projects and cascade to child scans/issues/evidence
drop policy if exists projects_delete on projects;
create policy projects_delete on projects for delete using (app.project_role(id) = 'owner');
grant delete on projects to webops_app;

create or replace function app.delete_project(p_project_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  v_role := app.project_role(p_project_id);
  if v_role is distinct from 'owner' then
    return false;
  end if;
  delete from projects where id = p_project_id;
  return true;
end;
$$;

grant execute on function app.delete_project(uuid) to webops_app;
