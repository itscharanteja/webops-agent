import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

type RateLimitOptions = {
  max?: number;
  timeWindowMs?: number;
};

type ClientRecord = {
  count: number;
  resetAt: number;
};

export function createRateLimiter(options: RateLimitOptions = {}) {
  const max = options.max ?? 120;
  const timeWindowMs = options.timeWindowMs ?? 60_000;
  const store = new Map<string, ClientRecord>();

  // Cleanup old window records every 2 minutes
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (record.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 120_000);
  interval.unref?.();

  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    // Exclude health checks and options
    if (
      request.method === 'OPTIONS' ||
      request.url === '/health' ||
      request.url === '/healthz'
    ) {
      return;
    }

    const authHeader = request.headers.authorization;
    const key = authHeader?.startsWith('Bearer ')
      ? `user:${authHeader.slice(7, 32)}`
      : `ip:${request.ip}`;

    const now = Date.now();
    let record = store.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + timeWindowMs };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', resetSeconds);

    if (record.count > max) {
      reply.header('Retry-After', resetSeconds);
      const error: Error & { statusCode?: number; code?: string } = new Error(
        'Too many requests, please slow down',
      );
      error.statusCode = 429;
      error.code = 'RATE_LIMITED';
      throw error;
    }
  };
}
