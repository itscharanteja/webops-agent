import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { crawlLimitsSchema, type Project } from '@webops/contracts';
import { buildApp } from './app.js';
import type { ProjectData, ProjectRepository } from './repository.js';

const ownerA = randomUUID();
const ownerB = randomUUID();

class MemoryRepository implements ProjectRepository {
  rows = new Map<string, { owner: string; project: Project }>();
  async list(userId: string, limit: number, offset: number) {
    const projects = [...this.rows.values()]
      .filter((row) => row.owner === userId)
      .map((row) => row.project);
    return {
      items: projects.slice(offset, offset + limit),
      nextOffset: projects.length > offset + limit ? offset + limit : null,
    };
  }
  async get(userId: string, id: string) {
    const row = this.rows.get(id);
    return row?.owner === userId ? row.project : null;
  }
  async create(userId: string, data: ProjectData) {
    const project: Project = {
      id: randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(project.id, { owner: userId, project });
    return project;
  }
  async update(
    userId: string,
    id: string,
    _previous: Project,
    data: ProjectData,
    _reapproved: boolean,
  ) {
    const row = this.rows.get(id);
    if (!row || row.owner !== userId) return null;
    row.project = { ...row.project, ...data };
    return row.project;
  }
}

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixtureApp(repository = new MemoryRepository()) {
  const app = await buildApp({
    repository,
    verifyToken: async (token) => {
      if (token === ownerA || token === ownerB) return token;
      throw new Error('Invalid token');
    },
    resolver: async () => ['93.184.215.14'],
    webOrigin: 'http://localhost:3000',
    logger: false,
  });
  apps.push(app);
  return { app, repository };
}

describe('project API boundary', () => {
  it('rejects unauthenticated reads and cross-project access', async () => {
    const { app, repository } = await fixtureApp();
    const project = await repository.create(ownerA, {
      name: 'A',
      baseUrl: 'https://example.com/',
      approvedOrigins: ['https://example.com'],
      crawlLimits: crawlLimitsSchema.parse({}),
    });
    const anonymous = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(anonymous.statusCode).toBe(401);
    const anonymousInvalidPost = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      payload: {},
    });
    expect(anonymousInvalidPost.statusCode).toBe(401);
    const otherUser = await app.inject({
      method: 'GET',
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${ownerB}` },
    });
    expect(otherUser.statusCode).toBe(404);
    const otherList = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${ownerB}` },
    });
    expect(otherList.json().items).toEqual([]);
  });

  it('requires explicit approval and rejects private or unapproved origins', async () => {
    const { app } = await fixtureApp();
    const headers = { authorization: `Bearer ${ownerA}` };
    const input = {
      name: 'Example',
      baseUrl: 'https://example.com/',
      approvedOrigins: ['https://example.com'],
    };
    const noApproval = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers,
      payload: input,
    });
    expect(noApproval.statusCode).toBe(400);
    const privateUrl = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers,
      payload: {
        ...input,
        baseUrl: 'http://127.0.0.1/',
        approvedOrigins: ['http://127.0.0.1'],
        authorizationConfirmed: true,
      },
    });
    expect(privateUrl.statusCode).toBe(400);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers,
      payload: { ...input, authorizationConfirmed: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().approvedOrigins).toEqual(['https://example.com']);
  });

  it('handles empty body gracefully when content-type is application/json', async () => {
    const { app } = await fixtureApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: {
        authorization: `Bearer ${ownerA}`,
        'content-type': 'application/json',
      },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FST_ERR_VALIDATION');
  });

  it('allows POST without body even when content-type is application/json', async () => {
    const { app, repository } = await fixtureApp();
    const project = await repository.create(ownerA, {
      name: 'A',
      baseUrl: 'https://example.com/',
      approvedOrigins: ['https://example.com'],
      crawlLimits: crawlLimitsSchema.parse({}),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${project.id}/scans`,
      headers: {
        authorization: `Bearer ${ownerA}`,
        'content-type': 'application/json',
      },
      payload: '',
    });
    // Route handler was reached successfully, did not crash in content-type parser
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SCANS_UNAVAILABLE');
  });

  it('exposes /health and /healthz endpoints without requiring authentication', async () => {
    const { app } = await fixtureApp();
    const healthz = await app.inject({ method: 'GET', url: '/healthz' });
    expect(healthz.statusCode).toBe(200);
    expect(healthz.json()).toEqual({ status: 'ok' });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('healthy');
    expect(health.json().checks).toBeDefined();
  });

  it('traces request ID and includes x-request-id header in response', async () => {
    const { app } = await fixtureApp();
    const customReqId = 'custom-request-id-12345';
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': customReqId },
    });
    expect(res.headers['x-request-id']).toBe(customReqId);

    const generatedRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(generatedRes.headers['x-request-id']).toBeTruthy();
  });

  it('enforces API rate limits and returns 429 when threshold exceeded', async () => {
    const { app } = await fixtureApp();
    // Simulate exceeding the rate limit with low limit fixture
    const limitedApp = await buildApp({
      repository: new MemoryRepository(),
      verifyToken: async () => ownerA,
      webOrigin: 'http://localhost:3000',
      logger: false,
      rateLimitMax: 3,
    });
    apps.push(limitedApp);

    for (let i = 0; i < 3; i++) {
      const res = await limitedApp.inject({
        method: 'GET',
        url: '/v1/projects',
        headers: { authorization: `Bearer ${ownerA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-ratelimit-remaining']).toBe(String(3 - (i + 1)));
    }

    // 4th request must be rejected with 429
    const blocked = await limitedApp.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${ownerA}` },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
