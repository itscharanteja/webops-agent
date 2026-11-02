import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { PgProjectRepository } from './repository.js';
import { PgScanRepository } from './scan-repository.js';
import { createScanRuntime } from './scan-runtime.js';
import type { ScanRuntime } from './scan-runtime.js';

const enabled = process.env.TEST_PHASE2 === '1';
describe.skipIf(!enabled)('Phase 2 fixture gate', () => {
  const owner = randomUUID();
  const other = randomUUID();
  const headers = { authorization: `Bearer ${owner}` };
  let pool: Pool;
  let runtime: ScanRuntime;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    runtime = createScanRuntime(process.env.REDIS_URL!);
    app = await buildApp({
      repository: new PgProjectRepository(pool),
      scanRepository: new PgScanRepository(pool),
      scanRuntime: runtime,
      verifyToken: async (token) => {
        if (token === owner || token === other) return token;
        throw new Error('Invalid token');
      },
      webOrigin: 'http://localhost:3000',
      logger: false,
    });
  });
  afterAll(async () => {
    if (app) await app.close();
    if (runtime) await runtime.close();
    if (pool) await pool.end();
  });

  async function createProject(baseUrl: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers,
      payload: {
        name: 'Phase 2 fixture',
        baseUrl,
        approvedOrigins: ['http://localhost:8080'],
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  }
  async function waitStatus(id: string, target: string[], timeoutMs = 60_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/scans/${id}`,
        headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const scan = response.json();
      if (target.includes(scan.status)) return scan;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Scan ${id} did not reach ${target.join(', ')}`);
  }
  async function count(url: string) {
    return (await (await fetch(url)).json()).count as number;
  }

  it('crawls approved pages, replays events, and never sends blocked requests or forms', async () => {
    const blockedBefore = await count('http://localhost:8081/_hits');
    const formBefore = await count('http://localhost:8080/_form_submissions');
    const projectId = await createProject('http://localhost:8080/index.html');
    const queued = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/scans`,
      headers,
    });
    expect(queued.statusCode, queued.body).toBe(202);
    const scanId = queued.json().id as string;
    const finished = await waitStatus(scanId, [
      'completed',
      'partial',
      'failed',
    ]);
    expect(finished.status).toBe('completed');
    const pagesResponse = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}/pages`,
      headers,
    });
    expect(pagesResponse.statusCode).toBe(200);
    const pages = pagesResponse.json().items as Array<{
      normalizedUrl: string;
      httpStatus: number;
    }>;
    expect(pages).toHaveLength(6);
    expect(pages.map((page) => page.normalizedUrl).sort()).toEqual(
      [
        'http://localhost:8080/index.html',
        'http://localhost:8080/about.html',
        'http://localhost:8080/catalog.html',
        'http://localhost:8080/contact.html',
        'http://localhost:8080/overflow.html',
        'http://localhost:8080/missing.html',
      ].sort(),
    );
    expect(
      pages.find((page) => page.normalizedUrl.endsWith('/missing.html'))
        ?.httpStatus,
    ).toBe(404);
    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}/events?after=0`,
      headers,
    });
    const events = eventsResponse.json().items as Array<{
      seq: number;
      message: string;
    }>;
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );
    const cursor = events[Math.floor(events.length / 2)]!.seq;
    const replay = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}/events?after=${cursor}`,
      headers,
    });
    expect(
      replay.json().items.map((event: { seq: number }) => event.seq),
    ).toEqual(
      events.filter((event) => event.seq > cursor).map((event) => event.seq),
    );
    const report = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}/report`,
      headers,
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().coverage.visitedUrls).toHaveLength(6);
    expect(
      report
        .json()
        .coverage.skipped.some((item: { url: string }) =>
          item.url.includes('169.254.169.254'),
        ),
    ).toBe(true);
    for (const path of [
      `/v1/scans/${scanId}`,
      `/v1/scans/${scanId}/events`,
      `/v1/scans/${scanId}/pages`,
      `/v1/scans/${scanId}/report`,
    ]) {
      const denied = await app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${other}` },
      });
      expect(denied.statusCode, path).toBe(404);
    }
    expect(await count('http://localhost:8081/_hits')).toBe(blockedBefore);
    expect(await count('http://localhost:8080/_form_submissions')).toBe(
      formBefore,
    );

    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const stream = await fetch(`${origin}/v1/scans/${scanId}/events`, {
      headers: {
        ...headers,
        accept: 'text/event-stream',
        'Last-Event-ID': String(cursor),
      },
    });
    expect(stream.status).toBe(200);
    const text = await stream.text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) =>
      Number(match[1]),
    );
    expect(ids).toEqual(
      events.filter((event) => event.seq > cursor).map((event) => event.seq),
    );
  }, 70_000);

  it('cancels a running navigation without marking the scan complete', async () => {
    const projectId = await createProject('http://localhost:8080/slow.html');
    const queued = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/scans`,
      headers,
    });
    expect(queued.statusCode, queued.body).toBe(202);
    const scanId = queued.json().id as string;
    await waitStatus(scanId, ['running']);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/scans/${scanId}/cancel`,
      headers,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const terminal = await waitStatus(
      scanId,
      ['cancelled', 'completed', 'partial', 'failed'],
      20_000,
    );
    expect(terminal.status).toBe('cancelled');
    const events = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}/events?after=0`,
      headers,
    });
    expect(events.json().items.at(-1).payload.status).toBe('cancelled');
  }, 30_000);

  it('records failed coverage when the queue cannot accept a scan', async () => {
    const unavailableRuntime: ScanRuntime = {
      enqueue: async () => {
        throw new Error('Queue unavailable');
      },
      publish: async () => undefined,
      subscribe: async () => async () => undefined,
      close: async () => undefined,
    };
    const isolated = await buildApp({
      repository: new PgProjectRepository(pool),
      scanRepository: new PgScanRepository(pool),
      scanRuntime: unavailableRuntime,
      verifyToken: async (token) => token,
      webOrigin: 'http://localhost:3000',
      logger: false,
    });
    try {
      const projectId = await createProject('http://localhost:8080/index.html');
      const response = await isolated.inject({
        method: 'POST',
        url: `/v1/projects/${projectId}/scans`,
        headers,
      });
      expect(response.statusCode).toBe(503);
      const history = await isolated.inject({
        method: 'GET',
        url: `/v1/projects/${projectId}/scans`,
        headers,
      });
      const scan = history.json().items[0];
      expect(scan.status).toBe('failed');
      const report = await isolated.inject({
        method: 'GET',
        url: `/v1/scans/${scan.id}/report`,
        headers,
      });
      expect(report.statusCode).toBe(200);
      expect(report.json().coverage.limitations).toContain(
        'Scan could not be queued',
      );
    } finally {
      await isolated.close();
    }
  });
});
