import { Pool } from 'pg';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { ChildProcess } from 'node:child_process';
import { SCAN_QUEUE_NAME, type ScanEvent } from '@webops/contracts';
import { WorkerRepository } from './repository.js';
import { processScan } from './process-scan.js';

const databaseUrl = process.env.WORKER_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error('WORKER_DATABASE_URL and REDIS_URL are required');

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const repo = new WorkerRepository(pool);
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publish = async (event: ScanEvent) => {
  await redis.publish(`scan:${event.scanId}:events`, JSON.stringify(event));
};
const active = new Set<ChildProcess>();
const worker = new Worker<{ scanId: string }>(
  SCAN_QUEUE_NAME,
  (job) => processScan(job, repo, publish, active),
  { connection: redis, concurrency: 1, lockDuration: 60_000 },
);
worker.on('failed', (job, error) => {
  process.stderr.write(
    `scan job ${job?.id ?? 'unknown'} failed: ${error.message}\n`,
  );
});
worker.on('error', (error) => {
  process.stderr.write(`worker error: ${error.message}\n`);
});

async function shutdown() {
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
