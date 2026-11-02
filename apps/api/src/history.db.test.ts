import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { PgProjectRepository } from './repository.js';
import { PgScanRepository } from './scan-repository.js';
import { IssueRepository } from './issue-repository.js';
import { createScanRuntime, type ScanRuntime } from './scan-runtime.js';

describe.skipIf(process.env.TEST_PHASE4 !== '1')('Phase 4 history gate', () => {
  const owner = randomUUID();
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
      issueRepository: new IssueRepository(pool),
      scanRuntime: runtime,
      verifyToken: async (token) => token,
      webOrigin: 'http://localhost:3000',
      logger: false,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (runtime) await runtime.close();
    if (pool) await pool.end();
  });

  async function project(baseUrl: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers,
      payload: {
        name: 'History fixture',
        baseUrl,
        approvedOrigins: ['http://localhost:8080'],
        authorizationConfirmed: true,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  }

  async function scan(projectId: string) {
    const queued = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/scans`,
      headers,
    });
    expect(queued.statusCode, queued.body).toBe(202);
    const id = queued.json().id as string;
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/scans/${id}`,
        headers,
      });
      const state = response.json().status as string;
      if (['completed', 'partial', 'failed', 'cancelled'].includes(state)) {
        expect(state, response.body).toBe('completed');
        return id;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Fixture scan did not finish');
  }

  it('preserves immutable historical report snapshots across later edits and repeat scans', async () => {
    const projectId = await project('http://localhost:8080/index.html');
    const scanId1 = await scan(projectId);

    // 1. Fetch Report A
    const report1Res = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId1}/report`,
      headers,
    });
    expect(report1Res.statusCode, report1Res.body).toBe(200);
    const report1 = report1Res.json();
    expect(report1.issueSnapshot.length).toBeGreaterThan(0);
    expect(report1.summary.issueCount).toBe(report1.issueSnapshot.length);

    const snapshotItem = report1.issueSnapshot[0];
    const originalTitle = snapshotItem.title;
    const originalPriority = snapshotItem.priority;

    // 2. Edit the issue on the live board
    const editRes = await app.inject({
      method: 'PATCH',
      url: `/v1/issues/${snapshotItem.issueId}`,
      headers: { ...headers, 'If-Match': '1' },
      payload: {
        title: 'New Edited Title For History Test',
        priority: 'P0',
      },
    });
    expect(editRes.statusCode, editRes.body).toBe(200);

    // 3. Run Scan B
    const scanId2 = await scan(projectId);
    const report2Res = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId2}/report`,
      headers,
    });
    expect(report2Res.statusCode, report2Res.body).toBe(200);

    // 4. Reopen Report A: snapshot must remain unchanged
    const report1AfterRes = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId1}/report`,
      headers,
    });
    expect(report1AfterRes.statusCode).toBe(200);
    const report1After = report1AfterRes.json();
    const itemAfter = report1After.issueSnapshot.find(
      (item: { issueId: string }) => item.issueId === snapshotItem.issueId,
    );
    expect(itemAfter.title).toBe(originalTitle);
    expect(itemAfter.priority).toBe(originalPriority);

    // 5. Test reports history list endpoint
    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/reports`,
      headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items.length).toBeGreaterThanOrEqual(2);

    // 6. Either the app role's permissions or the trigger must reject updates.
    await expect(
      pool.query(
        'update reports set summary = \'{"tampered": true}\'::jsonb where scan_id = $1',
        [scanId1],
      ),
    ).rejects.toThrow(
      /Historical reports are immutable|permission denied for table reports/,
    );
  }, 120_000);
});
