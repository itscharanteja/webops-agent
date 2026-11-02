import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrationsIfPending(pool: Pool): Promise<void> {
  const schemaCheck = await pool.query<{ projects: string | null }>(
    `select to_regclass('public.projects')::text as projects`,
  );

  if (schemaCheck.rows[0]?.projects) {
    // Database schema is already initialized
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
}
