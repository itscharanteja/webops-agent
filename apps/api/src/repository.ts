import { Pool, type PoolClient } from 'pg';
import {
  crawlLimitsSchema,
  type CrawlLimits,
  type Project,
} from '@webops/contracts';

export interface ProjectData {
  name: string;
  baseUrl: string;
  approvedOrigins: string[];
  crawlLimits: CrawlLimits;
}

export interface ProjectRepository {
  list(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: Project[]; nextOffset: number | null }>;
  get(userId: string, id: string): Promise<Project | null>;
  create(userId: string, data: ProjectData): Promise<Project>;
  update(
    userId: string,
    id: string,
    previous: Project,
    data: ProjectData,
    reapproved: boolean,
  ): Promise<Project | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

type ProjectRow = {
  id: string;
  name: string;
  base_url: string;
  approved_origins: string[];
  crawl_defaults: unknown;
  created_at: Date;
};

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    approvedOrigins: row.approved_origins,
    crawlLimits: crawlLimitsSchema.parse(row.crawl_defaults),
    createdAt: row.created_at.toISOString(),
  };
}

export class PgProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    userId: string,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [
        userId,
      ]);
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  list(userId: string, limit: number, offset: number) {
    return this.transaction(userId, async (client) => {
      const result = await client.query<ProjectRow>(
        'select id, name, base_url, approved_origins, crawl_defaults, created_at from projects order by created_at desc, id desc limit $1 offset $2',
        [limit + 1, offset],
      );
      return {
        items: result.rows.slice(0, limit).map(mapProject),
        nextOffset: result.rows.length > limit ? offset + limit : null,
      };
    });
  }

  get(userId: string, id: string) {
    return this.transaction(userId, async (client) => {
      const result = await client.query<ProjectRow>(
        'select id, name, base_url, approved_origins, crawl_defaults, created_at from projects where id = $1',
        [id],
      );
      return result.rows[0] ? mapProject(result.rows[0]) : null;
    });
  }

  create(userId: string, data: ProjectData) {
    return this.transaction(userId, async (client) => {
      const result = await client.query<ProjectRow>(
        `insert into projects (owner_id, name, base_url, approved_origins, crawl_defaults, approval_user_id, approved_at)
         values ($1, $2, $3, $4, $5, $1, now())
         returning id, name, base_url, approved_origins, crawl_defaults, created_at`,
        [
          userId,
          data.name,
          data.baseUrl,
          data.approvedOrigins,
          JSON.stringify(data.crawlLimits),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Project insert returned no row');
      await client.query(
        'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
        [row.id, userId, 'owner'],
      );
      return mapProject(row);
    });
  }

  update(
    userId: string,
    id: string,
    previous: Project,
    data: ProjectData,
    reapproved: boolean,
  ) {
    return this.transaction(userId, async (client) => {
      const result = await client.query<ProjectRow>(
        `update projects set name = $3, base_url = $4, approved_origins = $5, crawl_defaults = $6,
         approval_user_id = case when $7 then $2::uuid else approval_user_id end,
         approved_at = case when $7 then now() else approved_at end, updated_at = now()
         where id = $1 and owner_id = $2 and base_url = $8 and approved_origins = $9
         returning id, name, base_url, approved_origins, crawl_defaults, created_at`,
        [
          id,
          userId,
          data.name,
          data.baseUrl,
          data.approvedOrigins,
          JSON.stringify(data.crawlLimits),
          reapproved,
          previous.baseUrl,
          previous.approvedOrigins,
        ],
      );
      return result.rows[0] ? mapProject(result.rows[0]) : null;
    });
  }

  delete(userId: string, id: string) {
    return this.transaction(userId, async (client) => {
      try {
        const funcResult = await client.query<{ deleted: boolean }>(
          'select app.delete_project($1::uuid) as deleted',
          [id],
        );
        if (funcResult.rows[0]?.deleted !== undefined) {
          return Boolean(funcResult.rows[0].deleted);
        }
      } catch {
        // Fallback to direct table delete
      }
      const result = await client.query('delete from projects where id = $1', [
        id,
      ]);
      return (result.rowCount ?? 0) > 0;
    });
  }
}
