import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  crawlLimitsSchema,
  projectInputSchema,
  projectListSchema,
  projectPatchSchema,
  projectSchema,
  type Project,
} from '@webops/contracts';
import type { ProjectRepository } from './repository.js';
import type { TokenVerifier } from './auth.js';
import { registerScanRoutes } from './scan-routes.js';
import type { ScanRepository } from './scan-repository.js';
import type { ScanRuntime } from './scan-runtime.js';
import type { IssueRepository } from './issue-repository.js';
import { registerIssueRoutes } from './issue-routes.js';
import { createRateLimiter } from './rate-limiter.js';
import {
  PolicyError,
  validateApprovedOrigins,
  type Resolver,
} from './url-policy.js';

type Deps = {
  repository: ProjectRepository;
  verifyToken: TokenVerifier;
  resolver?: Resolver;
  webOrigin: string;
  logger?: boolean;
  scanRepository?: ScanRepository;
  scanRuntime?: ScanRuntime;
  issueRepository?: IssueRepository;
  healthCheck?: () => Promise<{ database: boolean; redis: boolean }>;
  rateLimitMax?: number;
  allowExternalScans?: boolean;
};
type ApiError = Error & { statusCode?: number; code?: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const authenticatedUsers = new WeakMap<FastifyRequest, string>();

function fail(statusCode: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  throw error;
}

async function userId(
  request: FastifyRequest,
  verifyToken: TokenVerifier,
): Promise<string> {
  const cached = authenticatedUsers.get(request);
  if (cached) return cached;
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return fail(401, 'UNAUTHORIZED', 'A bearer token is required');
  try {
    const id = await verifyToken(header.slice(7));
    authenticatedUsers.set(request, id);
    return id;
  } catch {
    return fail(401, 'UNAUTHORIZED', 'Invalid bearer token');
  }
}

async function normalizedData(
  input: {
    name: string;
    baseUrl: string;
    approvedOrigins: string[];
    crawlLimits?: Record<string, unknown> | undefined;
  },
  resolver?: Resolver,
) {
  const policy = await validateApprovedOrigins(
    input.baseUrl,
    input.approvedOrigins,
    resolver,
  );
  return {
    name: input.name,
    ...policy,
    crawlLimits: crawlLimitsSchema.parse(input.crawlLimits ?? {}),
  };
}

export async function buildApp(deps: Deps) {
  const app = Fastify({
    logger: deps.logger ?? true,
    bodyLimit: 64 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || body.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  await app.register(swagger, {
    openapi: {
      info: { title: 'WebOps API', version: '0.1.0' },
      servers: [{ url: '/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  const rateLimitHook = createRateLimiter({ max: deps.rateLimitMax ?? 120 });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    await rateLimitHook(request, reply);
    const origin = request.headers.origin;
    if (origin && origin !== deps.webOrigin)
      return fail(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed');
    if (origin) {
      reply.header('access-control-allow-origin', deps.webOrigin);
      reply.header('vary', 'Origin');
      reply.header(
        'access-control-allow-headers',
        'authorization, content-type, last-event-id, accept, x-request-id',
      );
      reply.header(
        'access-control-allow-methods',
        'GET, POST, PATCH, DELETE, OPTIONS',
      );
    }
  });

  app.get('/health', { schema: { hide: true } }, async (_request, reply) => {
    let checks = { database: 'ok', redis: 'ok' };
    let healthy = true;
    if (deps.healthCheck) {
      const result = await deps
        .healthCheck()
        .catch(() => ({ database: false, redis: false }));
      checks = {
        database: result.database ? 'ok' : 'down',
        redis: result.redis ? 'ok' : 'down',
      };
      healthy = result.database && result.redis;
    }
    const payload = {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
    return reply.code(healthy ? 200 : 503).send(payload);
  });

  app.get('/healthz', { schema: { hide: true } }, async (_request, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  app.addHook('preValidation', async (request) => {
    if (
      request.url.startsWith('/v1/') &&
      request.method !== 'OPTIONS' &&
      request.url !== '/health' &&
      request.url !== '/healthz'
    ) {
      await userId(request, deps.verifyToken);
    }
  });
  app.options('/*', { schema: { hide: true } }, async (_, reply) =>
    reply.code(204).send(),
  );

  app.setErrorHandler((error: ApiError, request, reply) => {
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    const code =
      status === 500 ? 'INTERNAL_ERROR' : (error.code ?? 'BAD_REQUEST');
    request.log.error({ err: error, requestId: request.id }, 'request failed');
    reply.code(status).send({
      error: {
        code,
        message: status === 500 ? 'Internal server error' : error.message,
        requestId: request.id,
      },
    });
  });

  app.get('/openapi.json', { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  app.post(
    '/v1/projects',
    {
      schema: {
        tags: ['projects'],
        body: zodToJsonSchema(projectInputSchema),
        response: { 201: zodToJsonSchema(projectSchema) },
      },
    },
    async (request, reply) => {
      const owner = await userId(request, deps.verifyToken);
      const parsed = projectInputSchema.safeParse(request.body);
      if (!parsed.success)
        return fail(
          400,
          'INVALID_PROJECT',
          parsed.error.issues[0]?.message ?? 'Invalid project',
        );
      try {
        const data = await normalizedData(parsed.data, deps.resolver);
        const project = await deps.repository.create(owner, data);
        return reply.code(201).send(project);
      } catch (error) {
        if (error instanceof PolicyError)
          return fail(400, 'INVALID_ORIGIN', error.message);
        throw error;
      }
    },
  );

  app.get(
    '/v1/projects',
    {
      schema: {
        tags: ['projects'],
        response: { 200: zodToJsonSchema(projectListSchema) },
      },
    },
    async (request) => {
      const owner = await userId(request, deps.verifyToken);
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
      const offset = Math.max(0, Number(query.offset ?? 0));
      if (
        !Number.isInteger(limit) ||
        !Number.isInteger(offset) ||
        offset > 1_000_000
      )
        return fail(
          400,
          'INVALID_PAGINATION',
          'Limit and offset must be integers',
        );
      return deps.repository.list(owner, limit, offset);
    },
  );

  app.get(
    '/v1/projects/:id',
    {
      schema: {
        tags: ['projects'],
        response: { 200: zodToJsonSchema(projectSchema) },
      },
    },
    async (request) => {
      const owner = await userId(request, deps.verifyToken);
      const { id } = request.params as { id: string };
      if (!uuid.test(id)) return fail(400, 'INVALID_ID', 'Invalid project ID');
      const project = await deps.repository.get(owner, id);
      if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
      return project;
    },
  );

  app.patch(
    '/v1/projects/:id',
    {
      schema: {
        tags: ['projects'],
        body: zodToJsonSchema(projectPatchSchema),
        response: { 200: zodToJsonSchema(projectSchema) },
      },
    },
    async (request) => {
      const owner = await userId(request, deps.verifyToken);
      const { id } = request.params as { id: string };
      if (!uuid.test(id)) return fail(400, 'INVALID_ID', 'Invalid project ID');
      const parsed = projectPatchSchema.safeParse(request.body);
      if (!parsed.success)
        return fail(
          400,
          'INVALID_PROJECT',
          parsed.error.issues[0]?.message ?? 'Invalid project',
        );
      const existing: Project | null = await deps.repository.get(owner, id);
      if (!existing) return fail(404, 'NOT_FOUND', 'Project not found');
      const policyChanged =
        parsed.data.baseUrl !== undefined ||
        parsed.data.approvedOrigins !== undefined;
      if (policyChanged && parsed.data.authorizationConfirmed !== true) {
        return fail(
          400,
          'AUTHORIZATION_REQUIRED',
          'Confirm authorization when changing scan origins',
        );
      }
      try {
        const data = await normalizedData(
          {
            name: parsed.data.name ?? existing.name,
            baseUrl: parsed.data.baseUrl ?? existing.baseUrl,
            approvedOrigins:
              parsed.data.approvedOrigins ?? existing.approvedOrigins,
            crawlLimits: {
              ...existing.crawlLimits,
              ...parsed.data.crawlLimits,
            },
          },
          deps.resolver,
        );
        const project = await deps.repository.update(
          owner,
          id,
          existing,
          data,
          policyChanged,
        );
        if (!project)
          return fail(
            409,
            'CONFLICT',
            'Project changed or you do not have edit access',
          );
        return project;
      } catch (error) {
        if (error instanceof PolicyError)
          return fail(400, 'INVALID_ORIGIN', error.message);
        throw error;
      }
    },
  );

  app.delete(
    '/v1/projects/:id',
    {
      schema: {
        tags: ['projects'],
        response: {
          204: { type: 'null', description: 'Project deleted' },
        },
      },
    },
    async (request, reply) => {
      const owner = await userId(request, deps.verifyToken);
      const { id } = request.params as { id: string };
      if (!uuid.test(id)) return fail(400, 'INVALID_ID', 'Invalid project ID');
      const existing = await deps.repository.get(owner, id);
      if (!existing) return fail(404, 'NOT_FOUND', 'Project not found');
      const deleted = await deps.repository.delete(owner, id);
      if (!deleted)
        return fail(
          403,
          'FORBIDDEN',
          'You do not have permission to delete this project',
        );
      return reply.code(204).send();
    },
  );
  registerScanRoutes(app, {
    projects: deps.repository,
    getUser: (request) => userId(request, deps.verifyToken),
    allowExternalScans:
      deps.allowExternalScans ?? process.env.NODE_ENV !== 'production',
    ...(deps.scanRepository ? { scans: deps.scanRepository } : {}),
    ...(deps.scanRuntime ? { runtime: deps.scanRuntime } : {}),
    ...(deps.resolver ? { resolver: deps.resolver } : {}),
  });
  registerIssueRoutes(app, {
    issues: deps.issueRepository,
    getUser: (request) => userId(request, deps.verifyToken),
    webOrigin: deps.webOrigin,
  });
  return app;
}
