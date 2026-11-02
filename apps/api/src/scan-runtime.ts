import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { SCAN_QUEUE_NAME, type ScanEvent } from '@webops/contracts';

export interface ScanRuntime {
  enqueue(scanId: string): Promise<void>;
  publish(event: ScanEvent): Promise<void>;
  subscribe(
    scanId: string,
    onEvent: (event: ScanEvent) => void,
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export function createScanRuntime(redisUrl: string): ScanRuntime {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(SCAN_QUEUE_NAME, { connection: redis });
  return {
    async enqueue(scanId) {
      await queue.add(
        'scan',
        { scanId },
        {
          jobId: scanId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 3600 },
        },
      );
    },
    async publish(event) {
      await redis.publish(`scan:${event.scanId}:events`, JSON.stringify(event));
    },
    async subscribe(scanId, onEvent) {
      const subscriber = redis.duplicate();
      const channel = `scan:${scanId}:events`;
      const handler = (_channel: string, raw: string) => {
        if (_channel !== channel) return;
        try {
          onEvent(JSON.parse(raw) as ScanEvent);
        } catch {
          /* A reconnect replays from Postgres. */
        }
      };
      subscriber.on('message', handler);
      await subscriber.subscribe(channel);
      return async () => {
        subscriber.off('message', handler);
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      };
    },
    async close() {
      await queue.close();
      await redis.quit();
    },
  };
}
