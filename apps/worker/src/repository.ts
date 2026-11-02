import { Pool, type PoolClient } from 'pg';
import type { ScanEvent, ScannerMessage } from '@webops/contracts';

type EventRow = {
  scan_id: string;
  seq: string;
  at: Date;
  level: ScanEvent['level'];
  phase: string;
  message: string;
  payload: Record<string, unknown>;
};
type ScanRow = {
  id: string;
  project_id: string;
  status: string;
  cancel_requested_at: Date | null;
  config_snapshot: unknown;
};
export type ScanJob = {
  id: string;
  projectId: string;
  status: string;
  cancelRequested: boolean;
  config: {
    v: number;
    baseUrl: string;
    approvedOrigins: string[];
    crawlLimits: Record<string, number>;
  };
};

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

export class WorkerRepository {
  constructor(private readonly pool: Pool) {}
  async close() {
    await this.pool.end();
  }

  private async tx<T>(
    scanId: string,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.scan_id', $1, true)", [
        scanId,
      ]);
      const value = await run(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async append(
    client: PoolClient,
    scanId: string,
    key: string,
    level: ScanEvent['level'],
    phase: string,
    message: string,
    payload: Record<string, unknown> = {},
  ): Promise<{ event: ScanEvent; inserted: boolean }> {
    const lock = await client.query(
      'select id from scans where id = $1 for update',
      [scanId],
    );
    if (!lock.rowCount) throw new Error('Worker scan scope denied');
    const existing = await client.query<EventRow>(
      'select scan_id, seq, at, level, phase, message, payload from scan_events where scan_id = $1 and idempotency_key = $2',
      [scanId, key],
    );
    if (existing.rows[0])
      return { event: mapEvent(existing.rows[0]), inserted: false };
    const result = await client.query<EventRow>(
      `insert into scan_events (scan_id, seq, level, phase, message, payload, idempotency_key)
       values ($1, (select coalesce(max(seq), 0) + 1 from scan_events where scan_id = $1), $2, $3, $4, $5, $6)
       returning scan_id, seq, at, level, phase, message, payload`,
      [scanId, level, phase, message, JSON.stringify(payload), key],
    );
    if (!result.rows[0]) throw new Error('Event insert returned no row');
    return { event: mapEvent(result.rows[0]), inserted: true };
  }

  load(scanId: string): Promise<ScanJob | null> {
    return this.tx(scanId, async (client) => {
      const result = await client.query<ScanRow>(
        'select id, project_id, status, cancel_requested_at, config_snapshot from scans where id = $1',
        [scanId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const config = row.config_snapshot as ScanJob['config'];
      if (config.v !== 1 || !Array.isArray(config.approvedOrigins))
        throw new Error('Invalid saved scan policy');
      return {
        id: row.id,
        projectId: row.project_id,
        status: row.status,
        cancelRequested: !!row.cancel_requested_at,
        config,
      };
    });
  }

  isCancelRequested(scanId: string): Promise<boolean> {
    return this.tx(scanId, async (client) => {
      const result = await client.query<{ cancel_requested_at: Date | null }>(
        'select cancel_requested_at from scans where id = $1',
        [scanId],
      );
      return !!result.rows[0]?.cancel_requested_at;
    });
  }

  async markRunning(scanId: string): Promise<void> {
    await this.tx(scanId, async (client) => {
      await client.query(
        "update scans set status = 'running', started_at = coalesce(started_at, now()), scanner_version = '0.2.0', check_version = 'none' where id = $1 and status in ('queued', 'running')",
        [scanId],
      );
    });
  }

  appendEvent(
    scanId: string,
    key: string,
    level: ScanEvent['level'],
    phase: string,
    message: string,
    payload: Record<string, unknown> = {},
  ) {
    return this.tx(scanId, (client) =>
      this.append(client, scanId, key, level, phase, message, payload),
    );
  }

  async savePage(
    scanId: string,
    message: Extract<ScannerMessage, { type: 'page' }>,
  ): Promise<void> {
    const page = message.payload;
    await this.tx(scanId, async (client) => {
      await client.query(
        `insert into scan_pages (scan_id, normalized_url, final_url, depth, http_status, title, timing_ms, visited_at, console_messages, failed_requests)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (scan_id, normalized_url) do update set final_url = excluded.final_url, http_status = excluded.http_status,
           title = excluded.title, timing_ms = excluded.timing_ms, visited_at = excluded.visited_at,
           console_messages = excluded.console_messages, failed_requests = excluded.failed_requests`,
        [
          scanId,
          page.normalized_url,
          page.final_url,
          page.depth,
          page.http_status,
          page.title,
          page.timing_ms,
          page.visited_at,
          JSON.stringify({ v: 1, items: page.console_messages }),
          JSON.stringify({ v: 1, items: page.failed_requests }),
        ],
      );
    });
  }

  async terminal(
    scanId: string,
    status: 'completed' | 'partial' | 'failed' | 'cancelled',
    coverage: {
      visitedUrls: string[];
      skipped: Array<{ url: string; reason: string }>;
      failedCount: number;
      limitations: string[];
    },
    error: string | null = null,
  ): Promise<{ event: ScanEvent; inserted: boolean }> {
    return this.tx(scanId, async (client) => {
      const scan = await client.query<{ status: string }>(
        'select status from scans where id = $1 for update',
        [scanId],
      );
      if (!scan.rows[0]) throw new Error('Worker scan scope denied');
      const alreadyTerminal = [
        'completed',
        'partial',
        'failed',
        'cancelled',
      ].includes(scan.rows[0].status);
      if (!alreadyTerminal) {
        await client.query(
          `update scans set status = $2, finished_at = now(), visited_count = $3, skipped_count = $4,
           failed_count = $5, error = $6 where id = $1`,
          [
            scanId,
            status,
            coverage.visitedUrls.length,
            coverage.skipped.length,
            coverage.failedCount,
            error,
          ],
        );
        await client.query(
          `insert into reports (scan_id, summary, coverage, issue_snapshot)
           values ($1,$2,$3,'[]'::jsonb) on conflict (scan_id) do nothing`,
          [
            scanId,
            JSON.stringify({ v: 1, status, issueCount: null }),
            JSON.stringify({ v: 1, ...coverage }),
          ],
        );
      }
      return this.append(
        client,
        scanId,
        'terminal',
        status === 'completed' ? 'info' : 'warn',
        'scan',
        status === 'completed' ? 'Scan completed' : `Scan ${status}`,
        { terminal: true, status },
      );
    });
  }

  async coverageSoFar(scanId: string): Promise<{
    visitedUrls: string[];
    skipped: Array<{ url: string; reason: string }>;
    failedCount: number;
    limitations: string[];
  }> {
    return this.tx(scanId, async (client) => {
      const pages = await client.query<{
        normalized_url: string;
        http_status: number | null;
      }>(
        'select normalized_url, http_status from scan_pages where scan_id = $1 order by normalized_url',
        [scanId],
      );
      return {
        visitedUrls: pages.rows.map((row) => row.normalized_url),
        skipped: [],
        failedCount: pages.rows.filter(
          (row) => row.http_status === null || row.http_status >= 400,
        ).length,
        limitations: ['Scanner stopped before reporting full coverage'],
      };
    });
  }
}
