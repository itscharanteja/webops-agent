import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  evidenceSchema,
  issueDetailSchema,
  issueListSchema,
  issuePatchSchema,
  issueSchema,
  issueStatusSchema,
  prioritySchema,
} from '@webops/contracts';
import type { IssueRepository } from './issue-repository.js';
import { ArtifactStore } from './artifact-store.js';
import { issueMarkdown, markdownFilename } from './markdown.js';

type Deps = {
  issues?: IssueRepository | undefined;
  getUser: (request: FastifyRequest) => Promise<string>;
  webOrigin: string;
};
type ApiError = Error & { statusCode?: number; code?: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const artifacts = new ArtifactStore();
function fail(statusCode: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  throw error;
}
function id(raw: string): string {
  if (!uuid.test(raw)) fail(400, 'INVALID_ID', 'Invalid ID');
  return raw;
}
function repo(deps: Deps): IssueRepository {
  return (
    deps.issues ?? fail(503, 'ISSUES_UNAVAILABLE', 'Issues service unavailable')
  );
}
function pagination(raw: unknown, fallback: number, max: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    fail(400, 'INVALID_PAGINATION', 'Invalid pagination');
  return value;
}

export function registerIssueRoutes(app: FastifyInstance, deps: Deps) {
  app.get(
    '/v1/projects/:id/issues',
    {
      schema: {
        tags: ['issues'],
        response: { 200: zodToJsonSchema(issueListSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const projectId = id((request.params as { id: string }).id);
      const query = request.query as Record<string, string | undefined>;
      if (query.status && !issueStatusSchema.safeParse(query.status).success)
        fail(400, 'INVALID_FILTER', 'Invalid status');
      if (query.priority && !prioritySchema.safeParse(query.priority).success)
        fail(400, 'INVALID_FILTER', 'Invalid priority');
      const sort = query.sort ?? 'last_seen';
      const direction = query.direction ?? 'desc';
      if (
        !['last_seen', 'priority', 'status'].includes(sort) ||
        !['asc', 'desc'].includes(direction)
      )
        fail(400, 'INVALID_SORT', 'Invalid sort');
      const result = await repo(deps).list(user, projectId, {
        status: query.status,
        priority: query.priority,
        ruleId: query.ruleId,
        sort: sort as 'last_seen' | 'priority' | 'status',
        direction: direction as 'asc' | 'desc',
        limit: Math.max(1, pagination(query.limit, 20, 100)),
        offset: pagination(query.offset, 0, 1_000_000),
      });
      if (!result) fail(404, 'NOT_FOUND', 'Project not found');
      return result;
    },
  );

  app.get(
    '/v1/issues/:id',
    {
      schema: {
        tags: ['issues'],
        response: { 200: zodToJsonSchema(issueDetailSchema) },
      },
    },
    async (request) => {
      const issue = await repo(deps).get(
        await deps.getUser(request),
        id((request.params as { id: string }).id),
      );
      if (!issue) fail(404, 'NOT_FOUND', 'Issue not found');
      return issue;
    },
  );

  app.patch(
    '/v1/issues/:id',
    {
      schema: {
        tags: ['issues'],
        body: zodToJsonSchema(issuePatchSchema),
        response: { 200: zodToJsonSchema(issueDetailSchema) },
      },
    },
    async (request) => {
      const user = await deps.getUser(request);
      const issueId = id((request.params as { id: string }).id);
      const patch = issuePatchSchema.safeParse(request.body);
      if (!patch.success)
        fail(
          400,
          'INVALID_ISSUE',
          patch.error.issues[0]?.message ?? 'Invalid edit',
        );
      const header = request.headers['if-match'];
      if (typeof header !== 'string')
        fail(428, 'VERSION_REQUIRED', 'If-Match issue version is required');
      const version = Number(header.replace(/^"|"$/g, ''));
      if (!Number.isSafeInteger(version) || version < 1)
        fail(400, 'INVALID_VERSION', 'Invalid issue version');
      const outcome = await repo(deps).update(
        user,
        issueId,
        version,
        patch.data,
      );
      if (outcome === 'missing') fail(404, 'NOT_FOUND', 'Issue not found');
      if (outcome === 'forbidden') fail(403, 'FORBIDDEN', 'Issue edit denied');
      if (outcome === 'conflict')
        fail(
          409,
          'VERSION_CONFLICT',
          'Issue was changed. Reload before editing.',
        );
      return repo(deps).get(user, issueId);
    },
  );

  app.get(
    '/v1/issues/:id/markdown',
    { schema: { tags: ['issues'] } },
    async (request, reply) => {
      const issue = await repo(deps).get(
        await deps.getUser(request),
        id((request.params as { id: string }).id),
      );
      if (!issue) fail(404, 'NOT_FOUND', 'Issue not found');
      return reply
        .type('text/markdown; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="${markdownFilename(issue)}"`,
        )
        .header('x-content-type-options', 'nosniff')
        .send(issueMarkdown(issue, deps.webOrigin));
    },
  );

  app.get(
    '/v1/evidence/:id',
    {
      schema: {
        tags: ['evidence'],
        response: { 200: zodToJsonSchema(evidenceSchema) },
      },
    },
    async (request) => {
      const proof = await repo(deps).evidence(
        await deps.getUser(request),
        id((request.params as { id: string }).id),
      );
      if (!proof) fail(404, 'NOT_FOUND', 'Proof not found');
      const retained =
        !proof.retained_until || proof.retained_until.getTime() > Date.now();
      let artifactUrl: string | null = null;
      let available = proof.verified && retained;
      if (proof.object_key && available) {
        artifactUrl = await artifacts.signedUrl(
          proof.object_key,
          proof.scan_id,
        );
        if (!artifactUrl) {
          const bytes = await artifacts.readLocal(
            proof.object_key,
            proof.scan_id,
            proof.checksum ?? '',
          );
          available = !!bytes;
          if (available) artifactUrl = `/v1/evidence/${proof.id}/artifact`;
        }
      }
      return {
        id: proof.id,
        scanId: proof.scan_id,
        pageId: proof.page_id,
        projectId: proof.project_id,
        kind: proof.kind,
        capturedAt: proof.captured_at.toISOString(),
        locator: proof.locator,
        payload: proof.payload,
        verified: proof.verified,
        retainedUntil: proof.retained_until?.toISOString() ?? null,
        artifactUrl,
        available,
        sourceUrl: proof.source_url,
        ruleIds: proof.ruleIds,
        issueIds: proof.issueIds,
      };
    },
  );

  app.get(
    '/v1/evidence/:id/artifact',
    { schema: { tags: ['evidence'] } },
    async (request, reply) => {
      const proof = await repo(deps).evidence(
        await deps.getUser(request),
        id((request.params as { id: string }).id),
      );
      if (!proof) fail(404, 'NOT_FOUND', 'Proof not found');
      if (
        !proof.verified ||
        !proof.object_key ||
        !proof.checksum ||
        (proof.retained_until && proof.retained_until.getTime() <= Date.now())
      )
        fail(404, 'PROOF_UNAVAILABLE', 'Proof unavailable');
      const bytes = await artifacts.readLocal(
        proof.object_key,
        proof.scan_id,
        proof.checksum,
      );
      if (!bytes) fail(404, 'PROOF_UNAVAILABLE', 'Proof unavailable');
      return reply
        .type(proof.mime_type ?? 'application/octet-stream')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    },
  );
}
