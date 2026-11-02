import { Pool, type PoolClient } from 'pg';
import type { Scan, ScanEvent, ScanPage } from '@webops/contracts';

type ScanRow = {
  id: string;
  project_id: string;
  status: Scan['status'];
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  visited_count: number;
  skipped_count: number;
  failed_count: number;
  cancel_requested_at: Date | null;
  error: string | null;
};
type EventRow = {
  scan_id: string;
  seq: string;
  at: Date;
  level: ScanEvent['level'];
  phase: string;
  message: string;
  payload: Record<string, unknown>;
};
type PageRow = {
  id: string;
  scan_id: string;
  normalized_url: string;
  final_url: string | null;
  depth: number;
  http_status: number | null;
  title: string | null;
  timing_ms: number | null;
  visited_at: Date | null;
  console_messages: { items: string[] };
  failed_requests: { items: Array<{ url: string; error: string }> };
};

function mapScan(row: ScanRow): Scan {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    queuedAt: row.queued_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    visitedCount: row.visited_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    cancelRequestedAt: row.cancel_requested_at?.toISOString() ?? null,
    error: row.error,
  };
}
function mapEvent(row: EventRow): ScanEvent {
  return {
    scanId: row.scan_id,
    seq: Number(row.seq),
    at: row.at.toISOString(),
    level: row.level,
    phase: row.phase,
    message: row.message,
    payload: row.payload,
  };
}
function mapPage(row: PageRow): ScanPage {
  return {
    id: row.id,
    scanId: row.scan_id,
    normalizedUrl: row.normalized_url,
    finalUrl: row.final_url,
    depth: row.depth,
    httpStatus: row.http_status,
    title: row.title,
    timingMs: row.timing_ms,
    visitedAt: row.visited_at?.toISOString() ?? null,
    consoleMessages: row.console_messages.items,
    failedRequests: row.failed_requests.items,
  };
}

export interface ScanRepository {
  create(
    userId: string,
    projectId: string,
  ): Promise<{ scan: Scan; event: ScanEvent } | null>;
  list(
    userId: string,
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: Scan[]; nextOffset: number | null }>;
  get(userId: string, id: string): Promise<Scan | null>;
  cancel(
    userId: string,
    id: string,
  ): Promise<{ scan: Scan; event: ScanEvent | null } | null>;
  failEnqueue(userId: string, id: string): Promise<ScanEvent>;
  events(
    userId: string,
    id: string,
    after: number,
    limit: number,
  ): Promise<ScanEvent[] | null>;
  pages(
    userId: string,
    id: string,
    limit: number,
    offset: number,
  ): Promise<{ items: ScanPage[]; nextOffset: number | null } | null>;
  report(userId: string, id: string): Promise<Record<string, unknown> | null>;
}

export class PgScanRepository implements ScanRepository {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(
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

  private async append(
    client: PoolClient,
    id: string,
    key: string,
    level: ScanEvent['level'],
    phase: string,
    message: string,
    payload: Record<string, unknown> = {},
  ): Promise<ScanEvent> {
    const lock = await client.query(
      'select id from scans where id = $1 for update',
      [id],
    );
    if (!lock.rowCount) throw new Error('Scan is not accessible');
    const prior = await client.query<EventRow>(
      'select scan_id, seq, at, level, phase, message, payload from scan_events where scan_id = $1 and idempotency_key = $2',
      [id, key],
    );
    if (prior.rows[0]) return mapEvent(prior.rows[0]);
    const result = await client.query<EventRow>(
      `insert into scan_events (scan_id, seq, level, phase, message, payload, idempotency_key)
       values ($1, (select coalesce(max(seq), 0) + 1 from scan_events where scan_id = $1), $2, $3, $4, $5, $6)
       returning scan_id, seq, at, level, phase, message, payload`,
      [id, level, phase, message, JSON.stringify(payload), key],
    );
    if (!result.rows[0]) throw new Error('Event insert returned no row');
    return mapEvent(result.rows[0]);
  }

  create(userId: string, projectId: string) {
    return this.tx(userId, async (client) => {
      const project = await client.query<{
        base_url: string;
        approved_origins: string[];
        crawl_defaults: unknown;
      }>(
        'select base_url, approved_origins, crawl_defaults from projects where id = $1 and app.can_edit_project(id)',
        [projectId],
      );
      const row = project.rows[0];
      if (!row) return null;
      const config = {
        v: 1,
        baseUrl: row.base_url,
        approvedOrigins: row.approved_origins,
        crawlLimits: row.crawl_defaults,
      };
      const inserted = await client.query<ScanRow>(
        `insert into scans (project_id, status, config_snapshot) values ($1, 'queued', $2)
         returning id, project_id, status, queued_at, started_at, finished_at, visited_count, skipped_count, failed_count, cancel_requested_at, error`,
        [projectId, JSON.stringify(config)],
      );
      if (!inserted.rows[0]) throw new Error('Scan insert returned no row');
      const scan = mapScan(inserted.rows[0]);
      const event = await this.append(
        client,
        scan.id,
        'queued',
        'info',
        'queue',
        'Scan queued',
      );
      return { scan, event };
    });
  }

  list(userId: string, projectId: string, limit: number, offset: number) {
    return this.tx(userId, async (client) => {
      const result = await client.query<ScanRow>(
        `select id, project_id, status, queued_at, started_at, finished_at, visited_count, skipped_count, failed_count, cancel_requested_at, error
         from scans where project_id = $1 order by queued_at desc, id desc limit $2 offset $3`,
        [projectId, limit + 1, offset],
      );
      return {
        items: result.rows.slice(0, limit).map(mapScan),
        nextOffset: result.rows.length > limit ? offset + limit : null,
      };
    });
  }

  get(userId: string, id: string) {
    return this.tx(userId, async (client) => {
      const result = await client.query<ScanRow>(
        `select id, project_id, status, queued_at, started_at, finished_at, visited_count, skipped_count, failed_count, cancel_requested_at, error from scans where id = $1`,
        [id],
      );
      return result.rows[0] ? mapScan(result.rows[0]) : null;
    });
  }

  cancel(userId: string, id: string) {
    return this.tx(userId, async (client) => {
      const result = await client.query<ScanRow>(
        `select id, project_id, status, queued_at, started_at, finished_at, visited_count, skipped_count, failed_count, cancel_requested_at, error from scans where id = $1 and app.can_edit_project(project_id) for update`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (['completed', 'partial', 'failed', 'cancelled'].includes(row.status))
        return { scan: mapScan(row), event: null };
      const updated = await client.query<ScanRow>(
        `update scans set cancel_requested_at = coalesce(cancel_requested_at, now()) where id = $1
         returning id, project_id, status, queued_at, started_at, finished_at, visited_count, skipped_count, failed_count, cancel_requested_at, error`,
        [id],
      );
      const event = await this.append(
        client,
        id,
        'cancel-requested',
        'warn',
        'control',
        'Cancellation requested',
      );
      return { scan: mapScan(updated.rows[0]!), event };
    });
  }

  failEnqueue(userId: string, id: string) {
    return this.tx(userId, async (client) => {
      await client.query(
        "update scans set status = 'failed', finished_at = now(), error = 'Queue unavailable' where id = $1 and status = 'queued'",
        [id],
      );
      await client.query(
        `insert into reports (scan_id, summary, coverage, issue_snapshot)
         values ($1, $2, $3, '[]'::jsonb) on conflict (scan_id) do nothing`,
        [
          id,
          JSON.stringify({ v: 1, status: 'failed', issueCount: null }),
          JSON.stringify({
            v: 1,
            visitedUrls: [],
            skipped: [],
            failedCount: 0,
            limitations: ['Scan could not be queued'],
          }),
        ],
      );
      return this.append(
        client,
        id,
        'queue-failed',
        'error',
        'queue',
        'Scan could not be queued',
        { terminal: true, status: 'failed' },
      );
    });
  }

  events(userId: string, id: string, after: number, limit: number) {
    return this.tx(userId, async (client) => {
      const accessible = await client.query(
        'select id from scans where id = $1',
        [id],
      );
      if (!accessible.rowCount) return null;
      const result = await client.query<EventRow>(
        'select scan_id, seq, at, level, phase, message, payload from scan_events where scan_id = $1 and seq > $2 order by seq limit $3',
        [id, after, limit],
      );
      return result.rows.map(mapEvent);
    });
  }

  pages(userId: string, id: string, limit: number, offset: number) {
    return this.tx(userId, async (client) => {
      const accessible = await client.query(
        'select id from scans where id = $1',
        [id],
      );
      if (!accessible.rowCount) return null;
      const result = await client.query<PageRow>(
        `select id, scan_id, normalized_url, final_url, depth, http_status, title, timing_ms, visited_at, console_messages, failed_requests
         from scan_pages where scan_id = $1 order by depth, normalized_url limit $2 offset $3`,
        [id, limit + 1, offset],
      );
      return {
        items: result.rows.slice(0, limit).map(mapPage),
        nextOffset: result.rows.length > limit ? offset + limit : null,
      };
    });
  }

  report(userId: string, id: string) {
    return this.tx(userId, async (client) => {
      const accessible = await client.query(
        'select id from scans where id = $1',
        [id],
      );
      if (!accessible.rowCount) return null;
      const result = await client.query<{
        id: string;
        scan_id: string;
        summary: unknown;
        coverage: unknown;
        issue_snapshot: unknown;
        created_at: Date;
      }>(
        'select id, scan_id, summary, coverage, issue_snapshot, created_at from reports where scan_id = $1',
        [id],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            scanId: row.scan_id,
            summary: row.summary,
            coverage: row.coverage,
            issueSnapshot: row.issue_snapshot,
            createdAt: row.created_at.toISOString(),
          }
        : null;
    });
  }
}
