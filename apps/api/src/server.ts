import { Pool } from 'pg';
import { buildApp } from './app.js';
import { createSupabaseVerifier } from './auth.js';
import { PgProjectRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
if (!databaseUrl || !supabaseUrl)
  throw new Error('DATABASE_URL and SUPABASE_URL are required');
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const schema = await pool.query(
  "select to_regclass('public.projects')::text as projects",
);
if (!schema.rows[0]?.projects)
  throw new Error('Database schema is missing. Apply the WebOps migrations.');
const app = await buildApp({
  repository: new PgProjectRepository(pool),
  verifyToken: createSupabaseVerifier(
    supabaseUrl,
    process.env.SUPABASE_JWT_AUDIENCE,
  ),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
});
await app.listen({
  host: '0.0.0.0',
  port: Number(process.env.API_PORT ?? 4000),
});
const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
