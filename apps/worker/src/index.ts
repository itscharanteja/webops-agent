import { createServer } from 'node:http';
import { Pool } from 'pg';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { ChildProcess } from 'node:child_process';
import { SCAN_QUEUE_NAME, type ScanEvent } from '@webops/contracts';
import { WorkerRepository } from './repository.js';
import { processScan } from './process-scan.js';
import { ArtifactStore } from './artifact-store.js';
import { pruneExpiredArtifacts } from './cleanup.js';

const databaseUrl = process.env.WORKER_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error('WORKER_DATABASE_URL and REDIS_URL are required');

const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2));
const useSsl =
  databaseUrl.includes('rds.amazonaws.com') ||
  databaseUrl.includes('sslmode=require') ||
  (process.env.NODE_ENV === 'production' && !databaseUrl.includes('localhost'));

const pool = new Pool({
  connectionString: databaseUrl,
  max: Math.max(4, concurrency * 2),
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const repo = new WorkerRepository(pool);
const artifactStore = new ArtifactStore();
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publish = async (event: ScanEvent) => {
  await redis.publish(`scan:${event.scanId}:events`, JSON.stringify(event));
};
const active = new Set<ChildProcess>();

// Periodic artifact retention cleanup
async function runCleanup() {
  try {
    const result = await pruneExpiredArtifacts(pool, artifactStore, 500);
    if (result.purgedCount > 0) {
      process.stdout.write(
        `Retention cleanup: purged ${result.purgedCount} expired artifacts\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `Retention cleanup error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

// Run cleanup at startup and every 60 minutes
void runCleanup();
const cleanupInterval = setInterval(() => void runCleanup(), 60 * 60 * 1000);
cleanupInterval.unref();

const worker = new Worker<{ scanId: string }>(
  SCAN_QUEUE_NAME,
  (job) => processScan(job, repo, publish, active),
  { connection: redis, concurrency, lockDuration: 60_000 },
);
worker.on('failed', (job, error) => {
  process.stderr.write(
    `scan job ${job?.id ?? 'unknown'} failed: ${error.message}\n`,
  );
});
worker.on('error', (error) => {
  process.stderr.write(`worker error: ${error.message}\n`);
});

// Lightweight worker health HTTP server
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4001);
const healthServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeJobs: active.size,
        concurrency,
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});
healthServer.listen(healthPort, '0.0.0.0', () => {
  process.stdout.write(`Worker health probe listening on port ${healthPort}\n`);
});

async function shutdown() {
  clearInterval(cleanupInterval);
  healthServer.close();
  for (const child of active) {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  }
  await worker.close();
  await redis.quit();
  await repo.close();
}
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
