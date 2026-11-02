import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { PgProjectRepository } from './repository.js';
import { PgScanRepository } from './scan-repository.js';
import { IssueRepository } from './issue-repository.js';
import { createScanRuntime, type ScanRuntime } from './scan-runtime.js';

describe.skipIf(process.env.TEST_PHASE3 !== '1')('Phase 3 fixture gate', () => {
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
        name: 'Findings fixture',
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

  it('publishes verified proof, edits safely, preserves edits on rescan, and enforces access', async () => {
    const projectId = await project('http://localhost:8080/index.html');
    const scanId = await scan(projectId);
    const pages = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}/pages`,
      headers,
    });
    expect(pages.statusCode, pages.body).toBe(200);
    expect(pages.json().items).toHaveLength(6);
    expect(
      pages
        .json()
        .items.every(
          (page: { screenshots: unknown[] }) => page.screenshots.length === 2,
        ),
    ).toBe(true);
    const board = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/issues`,
      headers,
    });
    expect(board.statusCode, board.body).toBe(200);
    const items = board.json().items as Array<{
      id: string;
      latestRuleId: string;
      version: number;
    }>;
    expect(items.map((item) => item.latestRuleId).sort()).toEqual(
      [
        'BROKEN_INTERNAL_LINK',
        'HORIZONTAL_OVERFLOW',
        'HTTP_PAGE_ERROR',
        'JS_CONSOLE_ERROR',
        'MISSING_IMAGE_ALT',
        'UNLABELED_FORM_CONTROL',
      ].sort(),
    );
    const beforeIds = items.map((item) => item.id).sort();
    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/issues?priority=P1&sort=priority&direction=asc`,
      headers,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items).toHaveLength(3);
    for (const item of items) {
      const detail = await app.inject({
        method: 'GET',
        url: `/v1/issues/${item.id}`,
        headers,
      });
      expect(detail.statusCode, detail.body).toBe(200);
      const latest = detail.json().observations[0];
      expect(latest.scanId).toBe(scanId);
      expect(latest.citations.length).toBeGreaterThan(0);
      for (const citation of latest.citations) {
        const proof = await app.inject({
          method: 'GET',
          url: `/v1/evidence/${citation.evidenceId}`,
          headers,
        });
        expect(proof.statusCode, proof.body).toBe(200);
        expect(proof.json().available).toBe(true);
        expect(proof.json().sourceUrl).toBeTruthy();
        const denied = await app.inject({
          method: 'GET',
          url: `/v1/evidence/${citation.evidenceId}`,
          headers: { authorization: `Bearer ${other}` },
        });
        expect(denied.statusCode).toBe(404);
        if (citation.kind === 'screenshot') {
          const artifact = await app.inject({
            method: 'GET',
            url: `/v1/evidence/${citation.evidenceId}/artifact`,
            headers,
          });
          expect(artifact.statusCode).toBe(200);
          expect(artifact.rawPayload.subarray(0, 3)).toEqual(
            Buffer.from([0xff, 0xd8, 0xff]),
          );
          const privateArtifact = await app.inject({
            method: 'GET',
            url: `/v1/evidence/${citation.evidenceId}/artifact`,
            headers: { authorization: `Bearer ${other}` },
          });
          expect(privateArtifact.statusCode).toBe(404);
        }
      }
    }
    const editedId = items.find(
      (item) => item.latestRuleId === 'MISSING_IMAGE_ALT',
    )!.id;
    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/issues/${editedId}`,
      headers: { ...headers, 'If-Match': '1' },
      payload: {
        title: 'Edited image issue\n# injected',
        description: 'Reviewed <script>alert(1)</script>',
        priority: 'P0',
        status: 'in_progress',
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().version).toBe(2);
    expect(edited.json().revisions).toHaveLength(1);
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/issues/${editedId}`,
      headers: { ...headers, 'If-Match': '1' },
      payload: { priority: 'P3' },
    });
    expect(stale.statusCode).toBe(409);
    const markdown = await app.inject({
      method: 'GET',
      url: `/v1/issues/${editedId}/markdown`,
      headers,
    });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.headers['content-disposition']).toMatch(
      /^attachment; filename="issue-[a-z0-9-]+\.md"$/,
    );
    expect(markdown.body).toContain('Priority: P0');
    expect(markdown.body).toContain('MISSING_IMAGE_ALT');
    expect(markdown.body).toContain(
      `/projects/${projectId}/scans/${scanId}/evidence/`,
    );
    expect(markdown.body).not.toContain('\n# injected\n');
    expect(markdown.body).not.toContain('<script>');
    const nextScan = await scan(projectId);
    expect(nextScan).not.toBe(scanId);
    const after = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/issues`,
      headers,
    });
    expect(
      after
        .json()
        .items.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual(beforeIds);
    const preserved = await app.inject({
      method: 'GET',
      url: `/v1/issues/${editedId}`,
      headers,
    });
    expect(preserved.json()).toMatchObject({
      title: 'Edited image issue\n# injected',
      description: 'Reviewed <script>alert(1)</script>',
      priority: 'P0',
      status: 'in_progress',
      version: 2,
    });
    expect(preserved.json().observations).toHaveLength(2);
    for (const path of [
      `/v1/projects/${projectId}/issues`,
      `/v1/issues/${editedId}`,
      `/v1/issues/${editedId}/markdown`,
    ]) {
      const denied = await app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${other}` },
      });
      expect(denied.statusCode, path).toBe(404);
    }
  }, 90_000);

  it('detects missing titles and first-party 5xx resource failures', async () => {
    const projectId = await project('http://localhost:8080/untitled.html');
    await scan(projectId);
    const board = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/issues`,
      headers,
    });
    expect(
      board
        .json()
        .items.map((item: { latestRuleId: string }) => item.latestRuleId)
        .sort(),
    ).toEqual(['FAILED_FIRST_PARTY_REQUEST', 'MISSING_PAGE_TITLE']);
  }, 45_000);
});
