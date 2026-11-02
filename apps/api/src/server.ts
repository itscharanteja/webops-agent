import { Pool } from 'pg';
import { buildApp } from './app.js';
import { createSupabaseVerifier } from './auth.js';
import { PgProjectRepository } from './repository.js';
import { PgScanRepository } from './scan-repository.js';
import { createScanRuntime } from './scan-runtime.js';
import { IssueRepository } from './issue-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !supabaseUrl || !redisUrl)
  throw new Error('DATABASE_URL, SUPABASE_URL and REDIS_URL are required');

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
try {
  const schema = await pool.query<{
    projects: string | null;
    scans: string | null;
    scan_phase: string | null;
  }>(
    `select to_regclass('public.projects')::text as projects,
      to_regclass('public.scans')::text as scans,
      (select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'scans' and column_name = 'cancel_requested_at') as scan_phase`,
  );
  if (
    !schema.rows[0]?.projects ||
    !schema.rows[0]?.scans ||
    !schema.rows[0]?.scan_phase
  )
    throw new Error(
      'Database schema is missing Phase 2 tables or columns. Apply the WebOps migrations.',
    );
} catch (error) {
  await pool.end();
  throw error;
}
const scanRuntime = createScanRuntime(redisUrl);
const app = await buildApp({
  repository: new PgProjectRepository(pool),
  scanRepository: new PgScanRepository(pool),
  issueRepository: new IssueRepository(pool),
  scanRuntime,
  verifyToken: createSupabaseVerifier(
    supabaseUrl,
    process.env.SUPABASE_JWT_AUDIENCE,
  ),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
});
const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ host: '0.0.0.0', port });
const shutdown = async () => {
  await app.close();
  await scanRuntime.close();
  await pool.end();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
