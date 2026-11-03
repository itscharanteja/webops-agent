import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  scanSchema,
  scanListSchema,
  scanEventsResponseSchema,
  scanPagesResponseSchema,
  scanReportSchema,
  reportListSchema,
  targetPersonaSchema,
  type TargetPersona,
  DiscordDispatcherService,
  PersonaTriageService,
} from '@webops/contracts';
import type { ProjectRepository } from './repository.js';
import type { ScanRepository } from './scan-repository.js';
import type { ScanRuntime } from './scan-runtime.js';
import {
  PolicyError,
  validateApprovedOrigins,
  type Resolver,
} from './url-policy.js';

type Deps = {
  projects: ProjectRepository;
  scans?: ScanRepository;
  runtime?: ScanRuntime;
  getUser: (request: FastifyRequest) => Promise<string>;
  resolver?: Resolver;
  allowExternalScans?: boolean;
};
type ApiError = Error & { statusCode?: number; code?: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(statusCode: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  throw error;
}
function requireScans(deps: Deps): ScanRepository {
  return (
    deps.scans ?? fail(503, 'SCANS_UNAVAILABLE', 'Scan service is unavailable')
  );
}
function requireRuntime(deps: Deps): ScanRuntime {
  return (
    deps.runtime ?? fail(503, 'QUEUE_UNAVAILABLE', 'Scan queue is unavailable')
  );
}
function requireId(raw: string) {
  if (!uuid.test(raw)) fail(400, 'INVALID_ID', 'Invalid ID');
  return raw;
}
function pageNumber(raw: unknown, fallback: number, maximum: number) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    fail(400, 'INVALID_PAGINATION', 'Invalid pagination value');
  return value;
}

export function registerScanRoutes(app: FastifyInstance, deps: Deps) {
  app.post(
    '/v1/projects/:id/scans',
    {
      schema: {
        tags: ['scans'],
        response: { 202: zodToJsonSchema(scanSchema) },
      },
    },
    async (request, reply) => {
      const user = await deps.getUser(request);
      const projectId = requireId((request.params as { id: string }).id);
      const project = await deps.projects.get(user, projectId);
      if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
      if (deps.allowExternalScans === false)
        return fail(
          503,
          'SCANS_DISABLED',
          'External scans are disabled until production egress controls are ready',
        );
      try {
        await validateApprovedOrigins(
          project.baseUrl,
          project.approvedOrigins,
          deps.resolver,
        );
      } catch (error) {
        if (error instanceof PolicyError)
          return fail(400, 'INVALID_POLICY', error.message);
        throw error;
      }
      const scans = requireScans(deps);
      const runtime = requireRuntime(deps);
      const created = await scans.create(user, projectId);
      if (!created) return fail(403, 'FORBIDDEN', 'Scan access denied');
      let queueTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          runtime.enqueue(created.scan.id),
          new Promise<never>((_, reject) => {
            queueTimer = setTimeout(
              () => reject(new Error('Queue timeout')),
              5_000,
            );
          }),
        ]);
      } catch {
        const failed = await scans.failEnqueue(user, created.scan.id);
        await runtime.publish(failed).catch(() => undefined);
        return fail(503, 'QUEUE_UNAVAILABLE', 'Scan queue is unavailable');
      } finally {
        if (queueTimer) clearTimeout(queueTimer);
      }
      await runtime.publish(created.event).catch(() => undefined);
      return reply.code(202).send(created.scan);
    },
  );

  app.get(
    '/v1/projects/:id/scans',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(scanListSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const projectId = requireId((request.params as { id: string }).id);
      if (!(await deps.projects.get(user, projectId)))
        return fail(404, 'NOT_FOUND', 'Project not found');
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.max(1, pageNumber(query.limit, 20, 100));
      const offset = pageNumber(query.offset, 0, 1_000_000);
      return requireScans(deps).list(user, projectId, limit, offset);
    },
  );

  app.get(
    '/v1/scans/:id',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(scanSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const scan = await requireScans(deps).get(user, id);
      if (!scan) return fail(404, 'NOT_FOUND', 'Scan not found');
      return scan;
    },
  );

  app.post(
    '/v1/scans/:id/cancel',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(scanSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const result = await requireScans(deps).cancel(user, id);
      if (!result) return fail(404, 'NOT_FOUND', 'Scan not found');
      if (result.event)
        await deps.runtime?.publish(result.event).catch(() => undefined);
      return result.scan;
    },
  );

  app.get(
    '/v1/scans/:id/events',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(scanEventsResponseSchema) },
      },
    },
    async (request, reply) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const query = request.query as { after?: string; limit?: string };
      const header = request.headers['last-event-id'];
      const after = pageNumber(
        typeof header === 'string' ? header : query.after,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const scans = requireScans(deps);
      const initial = await scans.events(user, id, after, 500);
      if (!initial) return fail(404, 'NOT_FOUND', 'Scan not found');
      if (!request.headers.accept?.includes('text/event-stream')) {
        const limit = Math.max(1, pageNumber(query.limit, 100, 500));
        const items = initial.slice(0, limit);
        return { items, nextAfter: items.at(-1)?.seq ?? after };
      }

      const runtime = requireRuntime(deps);
      let cursor = after;
      let ready = false;
      let closed = false;
      const pending: typeof initial = [];
      const send = (event: (typeof initial)[number]) => {
        if (closed || event.seq <= cursor) return;
        cursor = event.seq;
        reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.payload.terminal === true) {
          closed = true;
          reply.raw.end();
        }
      };
      const unsubscribe = await runtime.subscribe(id, (event) => {
        if (ready) send(event);
        else pending.push(event);
      });
      reply.hijack();
      reply.raw.writeHead(200, {
        ...(request.headers.origin
          ? {
              'access-control-allow-origin': request.headers.origin,
              vary: 'Origin',
            }
          : {}),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const heartbeat = setInterval(() => {
        if (!closed) reply.raw.write(': heartbeat\n\n');
      }, 15_000);
      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        void unsubscribe();
      };
      reply.raw.once('close', cleanup);
      for (const event of initial) send(event);
      while (!closed) {
        const more = await scans.events(user, id, cursor, 500);
        if (!more?.length) break;
        for (const event of more) send(event);
        if (more.length < 500) break;
      }
      ready = true;
      pending.sort((a, b) => a.seq - b.seq).forEach(send);
      return reply;
    },
  );

  app.get(
    '/v1/scans/:id/pages',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(scanPagesResponseSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const query = request.query as { limit?: string; offset?: string };
      const result = await requireScans(deps).pages(
        user,
        id,
        Math.max(1, pageNumber(query.limit, 50, 100)),
        pageNumber(query.offset, 0, 1_000_000),
      );
      if (!result) return fail(404, 'NOT_FOUND', 'Scan not found');
      return result;
    },
  );

  app.get(
    '/v1/scans/:id/report',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(scanReportSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const result = await requireScans(deps).report(user, id);
      if (!result) return fail(404, 'NOT_FOUND', 'Report not found');
      return result;
    },
  );

  app.get(
    '/v1/projects/:id/reports',
    {
      schema: {
        tags: ['scans'],
        response: { 200: zodToJsonSchema(reportListSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const projectId = requireId((request.params as { id: string }).id);
      const query = request.query as { limit?: string; offset?: string };
      const result = await requireScans(deps).listReports(
        user,
        projectId,
        Math.max(1, pageNumber(query.limit, 20, 100)),
        pageNumber(query.offset, 0, 1_000_000),
      );
      if (!result) return fail(404, 'NOT_FOUND', 'Project not found');
      return result;
    },
  );

  app.get(
    '/v1/scans/:id/deliverables/:persona/markdown',
    { schema: { tags: ['scans'] } },
    async (request, reply) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const personaParam = (request.params as { persona: string }).persona;
      const parsedPersona = targetPersonaSchema.safeParse(personaParam);
      if (!parsedPersona.success) {
        return fail(400, 'INVALID_PERSONA', 'Invalid persona discipline');
      }
      const persona = parsedPersona.data;
      const scan = await requireScans(deps).get(user, id);
      if (!scan) return fail(404, 'NOT_FOUND', 'Scan not found');
      const project = await deps.projects.get(user, scan.projectId);
      if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
      const report = await requireScans(deps).report(user, id);
      if (!report) return fail(404, 'NOT_FOUND', 'Report not found');

      let markdown = '';
      const deliverables = (report.personaDeliverables as any) ?? {};
      if (deliverables[persona]?.markdownContent) {
        markdown = deliverables[persona].markdownContent;
      } else {
        const triage = new PersonaTriageService();
        const items = (report.issueSnapshot as any[]).map((snap) => ({
          issueId: snap.issueId,
          fingerprint: snap.fingerprint,
          title: snap.title,
          description: snap.description,
          priority: snap.priority,
          status: snap.status,
          affectedUrl: snap.affectedUrl,
          ruleId: snap.ruleId,
          targetPersona:
            snap.targetPersona ?? triage.classify(snap.ruleId, snap.facts),
          observed: snap.explanation?.observed ?? '',
          impact: snap.explanation?.impact ?? '',
          reproductionSteps: snap.explanation?.reproductionSteps ?? [],
          suggestedFix: snap.explanation?.suggestedFix ?? '',
          evidenceIds: snap.evidenceIds ?? [],
        }));
        markdown = triage.generateMarkdownPackage(
          {
            id: scan.id,
            projectId: project.id,
            projectBaseUrl: project.baseUrl,
          },
          persona,
          items,
        );
      }

      return reply
        .type('text/markdown; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="webops-${persona}-audit-${id.slice(0, 8)}.md"`,
        )
        .header('x-content-type-options', 'nosniff')
        .send(markdown);
    },
  );

  app.post(
    '/v1/projects/:id/discord/test',
    { schema: { tags: ['projects'] } },
    async (request, reply) => {
      const user = await deps.getUser(request);
      const projectId = requireId((request.params as { id: string }).id);
      const project = await deps.projects.get(user, projectId);
      if (!project) return fail(404, 'NOT_FOUND', 'Project not found');

      const body = request.body as { webhookUrl?: string; track?: string };
      if (!body?.webhookUrl || typeof body.webhookUrl !== 'string') {
        return fail(400, 'INVALID_BODY', 'webhookUrl is required');
      }

      const dispatcher = new DiscordDispatcherService();
      if (!dispatcher.validateDiscordWebhookUrl(body.webhookUrl)) {
        return fail(
          400,
          'INVALID_WEBHOOK_URL',
          'Webhook URL must be a valid https://discord.com/api/webhooks/ endpoint',
        );
      }

      const track = (body.track as TargetPersona | 'general') || 'general';
      try {
        await dispatcher.sendTestPing(body.webhookUrl, track);
        return reply.code(200).send({
          ok: true,
          message: 'Discord test ping sent successfully!',
        });
      } catch (err) {
        return fail(
          502,
          'DISCORD_DELIVERY_FAILED',
          err instanceof Error
            ? err.message
            : 'Failed to reach Discord webhook',
        );
      }
    },
  );

  app.post(
    '/v1/scans/:id/dispatch-discord',
    { schema: { tags: ['scans'] } },
    async (request, reply) => {
      const user = await deps.getUser(request);
      const id = requireId((request.params as { id: string }).id);
      const scan = await requireScans(deps).get(user, id);
      if (!scan) return fail(404, 'NOT_FOUND', 'Scan not found');
      const project = await deps.projects.get(user, scan.projectId);
      if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
      const report = await requireScans(deps).report(user, id);
      if (!report) return fail(404, 'NOT_FOUND', 'Report not found');

      const body = request.body as { persona?: string };
      const parsedPersona = targetPersonaSchema.safeParse(body?.persona);
      if (!parsedPersona.success) {
        return fail(400, 'INVALID_PERSONA', 'Target persona is required');
      }
      const persona = parsedPersona.data;

      const webhooks = project.discordWebhooks;
      let targetWebhook: string | undefined = undefined;
      if (webhooks) {
        if (persona === 'ui_ux') targetWebhook = webhooks.uiUxWebhookUrl;
        else if (persona === 'frontend')
          targetWebhook = webhooks.frontendWebhookUrl;
        else if (persona === 'backend')
          targetWebhook = webhooks.backendWebhookUrl;
        else if (persona === 'content_seo')
          targetWebhook = webhooks.contentSeoWebhookUrl;
        if (!targetWebhook) targetWebhook = webhooks.defaultWebhookUrl;
      }

      if (!targetWebhook) {
        return fail(
          400,
          'WEBHOOK_NOT_CONFIGURED',
          `No Discord webhook configured for ${persona} or general channel in project settings.`,
        );
      }

      const dispatcher = new DiscordDispatcherService();
      const deliverables = (report.personaDeliverables as any) ?? {};
      const trackSummary = deliverables[persona]?.summary ?? {
        issueCount: (report.issueSnapshot as any[]).filter(
          (i) => i.targetPersona === persona,
        ).length,
        criticalCount: (report.issueSnapshot as any[]).filter(
          (i) =>
            i.targetPersona === persona &&
            (i.priority === 'P0' || i.priority === 'P1'),
        ).length,
      };

      const appBaseUrl =
        process.env.WEBOPS_WEB_ORIGIN || 'http://localhost:3000';

      try {
        await dispatcher.dispatchTrackPackage(
          targetWebhook,
          id,
          project.id,
          persona,
          trackSummary.issueCount,
          trackSummary.criticalCount,
          appBaseUrl,
        );
        return reply.code(200).send({
          ok: true,
          message: `Dispatched ${persona} deliverable package to Discord!`,
        });
      } catch (err) {
        return fail(
          502,
          'DISCORD_DELIVERY_FAILED',
          err instanceof Error ? err.message : 'Failed to dispatch to Discord',
        );
      }
    },
  );
}
