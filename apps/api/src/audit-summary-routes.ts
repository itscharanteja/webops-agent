import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  auditSummaryDraftSchema,
  structuredErrorSchema,
  scanReportSchema,
  type AuditSummaryDraft,
} from '@webops/contracts';
import type { ProjectRepository } from './repository.js';
import type { ScanRepository } from './scan-repository.js';
import { draftAuditSummary } from './audit-summary.js';

type Deps = {
  projects: ProjectRepository;
  scans?: ScanRepository;
  getUser: (request: FastifyRequest) => Promise<string>;
  draft?: typeof draftAuditSummary;
};
export function registerAuditSummaryRoutes(app: FastifyInstance, deps: Deps) {
  const cache = new Map<
    string,
    { until: number; result: Promise<AuditSummaryDraft> }
  >();
  app.post(
    '/v1/scans/:id/summary-draft',
    {
      schema: {
        tags: ['scans'],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: zodToJsonSchema(auditSummaryDraftSchema),
          401: zodToJsonSchema(structuredErrorSchema),
          404: zodToJsonSchema(structuredErrorSchema),
          409: zodToJsonSchema(structuredErrorSchema),
          503: zodToJsonSchema(structuredErrorSchema),
        },
      },
    },
    async (request, reply) => {
      const user = await deps.getUser(request);
      const id = (request.params as { id: string }).id;
      if (!deps.scans)
        return reply.code(503).send({
          error: {
            code: 'SCANS_UNAVAILABLE',
            message: 'Scan service unavailable',
          },
        });
      const scan = await deps.scans.get(user, id);
      if (!scan || !(await deps.projects.get(user, scan.projectId)))
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Scan not found' } });
      if (['queued', 'running'].includes(scan.status))
        return reply.code(409).send({
          error: {
            code: 'SCAN_RUNNING',
            message: 'Summary drafting is available after the scan has ended',
          },
        });
      // Authorization always runs before checking the cache. Drafts never modify reports.
      const saved = await deps.scans.report(user, id);
      if (!saved)
        return reply.code(404).send({
          error: {
            code: 'REPORT_UNAVAILABLE',
            message: 'No saved report is available',
          },
        });
      const report = scanReportSchema.parse(saved);
      const cached = cache.get(id);
      if (cached && cached.until > Date.now()) return cached.result;
      const result = (deps.draft ?? draftAuditSummary)({
        scan,
        items: report.issueSnapshot,
        visitedCount: report.coverage.visitedUrls.length,
        skippedCount: report.coverage.skipped.length,
      });
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      const entry = { until: Date.now() + 15 * 60_000, result };
      cache.set(id, entry);
      try {
        const draft = await result;
        if (draft.source === 'fallback') entry.until = Date.now() + 30_000;
        return draft;
      } catch (error) {
        cache.delete(id);
        throw error;
      }
    },
  );
}
