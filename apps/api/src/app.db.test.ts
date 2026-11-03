import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { PgProjectRepository } from './repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('project API with Postgres RLS', () => {
  it('persists an approved project and hides it from another user', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const owner = randomUUID();
    const other = randomUUID();
    const app = await buildApp({
      repository: new PgProjectRepository(pool),
      verifyToken: async (token) => {
        if (token === owner || token === other) return token;
        throw new Error('Invalid test token');
      },
      resolver: async () => ['93.184.215.14'],
      webOrigin: 'http://localhost:3000',
      logger: false,
    });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/projects',
        headers: { authorization: `Bearer ${owner}` },
        payload: {
          name: 'Database gate',
          baseUrl: 'https://example.com/',
          approvedOrigins: ['https://example.com'],
          authorizationConfirmed: true,
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id as string;
      const ownerRead = await app.inject({
        method: 'GET',
        url: `/v1/projects/${id}`,
        headers: { authorization: `Bearer ${owner}` },
      });
      expect(ownerRead.statusCode).toBe(200);
      const otherRead = await app.inject({
        method: 'GET',
        url: `/v1/projects/${id}`,
        headers: { authorization: `Bearer ${other}` },
      });
      expect(otherRead.statusCode).toBe(404);
      const otherList = await app.inject({
        method: 'GET',
        url: '/v1/projects',
        headers: { authorization: `Bearer ${other}` },
      });
      expect(otherList.json().items).toEqual([]);
      const unapprovedChange = await app.inject({
        method: 'PATCH',
        url: `/v1/projects/${id}`,
        headers: { authorization: `Bearer ${owner}` },
        payload: {
          baseUrl: 'https://example.org/',
          approvedOrigins: ['https://example.org'],
        },
      });
      expect(unapprovedChange.statusCode).toBe(400);

      // Non-owner cannot delete
      const nonOwnerDelete = await app.inject({
        method: 'DELETE',
        url: `/v1/projects/${id}`,
        headers: { authorization: `Bearer ${other}` },
      });
      expect(nonOwnerDelete.statusCode).toBe(404);

      // Owner can delete
      const ownerDelete = await app.inject({
        method: 'DELETE',
        url: `/v1/projects/${id}`,
        headers: { authorization: `Bearer ${owner}` },
      });
      expect(ownerDelete.statusCode).toBe(204);

      // Project is gone
      const deletedRead = await app.inject({
        method: 'GET',
        url: `/v1/projects/${id}`,
        headers: { authorization: `Bearer ${owner}` },
      });
      expect(deletedRead.statusCode).toBe(404);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
