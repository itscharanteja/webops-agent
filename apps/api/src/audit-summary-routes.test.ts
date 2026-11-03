import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectRepository } from './repository.js';
import type { ScanRepository } from './scan-repository.js';
import { registerAuditSummaryRoutes } from './audit-summary-routes.js';
import type { AuditSummaryDraft } from '@webops/contracts';

const scanId = randomUUID(),
  projectId = randomUUID(),
  now = new Date().toISOString();
async function fixture(status = 'completed') {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const typed = error as Error & { statusCode?: number; code?: string };
    return reply
      .code(typed.statusCode ?? 500)
      .send({ error: { code: typed.code ?? 'ERROR', message: typed.message } });
  });

  const report = {
    id: randomUUID(),
    scanId,
    summary: { v: 1 },
    coverage: {
      v: 1,
      visitedUrls: [],
      skipped: [],
      failedCount: 0,
      limitations: [],
    },
    issueSnapshot: [],
    createdAt: now,
  };
  const draft = vi.fn(
    async () =>
      ({
        v: 1,
        scanId,
        source: 'fallback',
        generatedAt: now,
        overview: 'No findings',
        limitation: null,
        highlights: [],
      }) as AuditSummaryDraft,
  );
  registerAuditSummaryRoutes(app, {
    projects: {
      get: async (user: string) =>
        user === 'owner' ? { id: projectId } : null,
    } as unknown as ProjectRepository,
    scans: {
      get: async () => ({ id: scanId, projectId, status }),
      report: async () => report,
    } as unknown as ScanRepository,
    getUser: async (request) => {
      const user = request.headers.authorization;
      if (!user)
        throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
      return user;
    },
    draft,
  });
  return { app, draft, report };
}
describe('authorized summary drafts', () => {
  it('requires authentication and rejects other projects even when a draft is cached', async () => {
    const { app, draft, report } = await fixture();
    const snapshot = JSON.stringify(report);
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/scans/${scanId}/summary-draft`,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/scans/${scanId}/summary-draft`,
            headers: { authorization: 'owner' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/scans/${scanId}/summary-draft`,
            headers: { authorization: 'other-project' },
          })
        ).statusCode,
      ).toBe(404);
      await app.inject({
        method: 'POST',
        url: `/v1/scans/${scanId}/summary-draft`,
        headers: { authorization: 'owner' },
      });
      expect(draft).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(report)).toBe(snapshot);
    } finally {
      await app.close();
    }
  });
  it.each(['running', 'queued'])(
    'does not invoke the model during a %s scan',
    async (status) => {
      const { app, draft } = await fixture(status);
      try {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: `/v1/scans/${scanId}/summary-draft`,
              headers: { authorization: 'owner' },
            })
          ).statusCode,
        ).toBe(409);
        expect(draft).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );
});
