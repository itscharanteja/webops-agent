import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getAdminPool(
  appPool: Pool,
): Promise<{ pool: Pool; isDedicated: boolean }> {
  const adminUrl =
    process.env.DATABASE_ADMIN_URL ||
    (() => {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) return null;
      try {
        const u = new URL(dbUrl);
        if (
          u.hostname === 'localhost' ||
          u.hostname === '127.0.0.1' ||
          u.hostname === 'postgres'
        ) {
          u.username = 'postgres';
          u.password = process.env.POSTGRES_PASSWORD || 'postgres_dev_password';
          return u.toString();
        }
      } catch {}
      return null;
    })();

  if (adminUrl) {
    try {
      const cleanUrl = adminUrl.replace(/[?&]sslmode=[^&]+/, '');
      const testPool = new Pool({
        connectionString: cleanUrl,
        max: 2,
        connectionTimeoutMillis: 3000,
      });
      await testPool.query('select 1');
      return { pool: testPool, isDedicated: true };
    } catch {}
  }

  return { pool: appPool, isDedicated: false };
}

export async function runMigrationsIfPending(appPool: Pool): Promise<void> {
  const { pool, isDedicated } = await getAdminPool(appPool);

  try {
    const schemaCheck = await pool.query<{ projects: string | null }>(
      `select to_regclass('public.projects')::text as projects`,
    );

    if (schemaCheck.rows[0]?.projects) {
      // Database schema is already initialized. Ensure delete policy & permissions are present.
      try {
        await pool.query(`
          do $$ begin
            if not exists (select 1 from pg_policies where policyname = 'projects_delete') then
              create policy projects_delete on projects for delete using (app.project_role(id) = 'owner');
            end if;
          end $$;
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

          -- Apply Persona-Targeted Triage columns and permissions
          alter table issue_observations
            add column if not exists target_persona text not null default 'frontend'
            check (target_persona in ('ui_ux', 'frontend', 'backend', 'content_seo'));

          create index if not exists idx_observations_persona
            on issue_observations(target_persona);

          alter table reports
            add column if not exists persona_deliverables jsonb not null default '{}'::jsonb;

          alter table projects
            add column if not exists discord_webhooks jsonb not null default '{}'::jsonb;

          do $$ begin
            if exists (select 1 from pg_roles where rolname = 'webops_worker') then
              grant update(persona_deliverables) on reports to webops_worker;
            end if;
            if exists (select 1 from pg_roles where rolname = 'webops_app') then
              grant update(discord_webhooks) on projects to webops_app;
            end if;
          end $$;
        `);
      } catch (err) {
        console.warn('  Notice: could not apply schema update:', err);
      }
      return;
    }

    console.log('🔄 Initializing database schema: applying migrations...');

    // Try locating migrations relative to dist/src or root
    const potentialPaths = [
      path.resolve(__dirname, '../../../../supabase/migrations'),
      path.resolve(__dirname, '../../../supabase/migrations'),
      path.resolve(__dirname, '../migrations'),
      path.resolve(__dirname, './migrations'),
      '/app/supabase/migrations',
    ];

    let migrationsDir: string | null = null;
    for (const candidate of potentialPaths) {
      try {
        const files = await readdir(candidate);
        if (files.some((f) => f.endsWith('.sql'))) {
          migrationsDir = candidate;
          break;
        }
      } catch {}
    }

    if (!migrationsDir) {
      console.warn(
        '⚠️ Migrations directory not found. Please apply migrations manually.',
      );
      return;
    }

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      console.log(`  Applying migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = await readFile(filePath, 'utf-8');
      try {
        await pool.query(sql);
      } catch (err) {
        console.error(`  Error applying ${file}:`, err);
        // Continue applying others or throw depending on severity
      }
    }

    console.log('✅ Database migrations successfully applied!');
  } finally {
    if (isDedicated) {
      await pool.end();
    }
  }
}
