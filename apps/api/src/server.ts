import { Pool } from 'pg';
import { buildApp } from './app.js';
import { createAuthVerifier } from './auth.js';
import { PgProjectRepository } from './repository.js';
import { PgScanRepository } from './scan-repository.js';
import { createScanRuntime } from './scan-runtime.js';
import { IssueRepository } from './issue-repository.js';
import { runMigrationsIfPending } from './auto-migrate.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error('DATABASE_URL and REDIS_URL are required');

const useSsl =
  databaseUrl.includes('rds.amazonaws.com') ||
  databaseUrl.includes('sslmode=require') ||
  (process.env.NODE_ENV === 'production' && !databaseUrl.includes('localhost'));

// Strip sslmode query param so pg-connection-string doesn't enforce strict CA verification
const cleanDatabaseUrl = databaseUrl.replace(/[?&]sslmode=[^&]+/, '');

const pool = new Pool({
  connectionString: cleanDatabaseUrl,
  max: 10,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  await runMigrationsIfPending(pool);

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
  ) {
    console.warn(
      '⚠️ Database schema is missing Phase 2 tables or columns. Run migrations.',
    );
  }
} catch (error) {
  console.error('Database connection/migration check error:', error);
}

const scanRuntime = createScanRuntime(redisUrl);
const app = await buildApp({
  repository: new PgProjectRepository(pool),
  scanRepository: new PgScanRepository(pool),
  issueRepository: new IssueRepository(pool),
  scanRuntime,
  verifyToken: createAuthVerifier({
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cognitoRegion:
      process.env.COGNITO_REGION ?? process.env.AWS_REGION ?? 'ap-south-1',
    cognitoClientId: process.env.COGNITO_CLIENT_ID,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAudience: process.env.SUPABASE_JWT_AUDIENCE,
  }),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  healthCheck: async () => {
    let database = false;
    let redis = false;
    try {
      const res = await pool.query('select 1');
      database = (res.rowCount ?? 0) > 0;
    } catch {}
    try {
      redis = true;
    } catch {}
    return { database, redis };
  },
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';
await app.listen({ port, host });
console.log(`API server listening on ${host}:${port}`);
