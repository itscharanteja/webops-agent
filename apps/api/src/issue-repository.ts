import { Pool, type PoolClient } from 'pg';
import type { Issue, IssueDetail, TargetPersona } from '@webops/contracts';
import type { z } from 'zod';
import { issuePatchSchema } from '@webops/contracts';

type Patch = z.infer<typeof issuePatchSchema>;
type IssueRow = {
  id: string;
  project_id: string;
  fingerprint: string;
  title: string;
  description: string;
  priority: Issue['priority'];
  status: Issue['status'];
  version: number;
  first_seen: Date;
  last_seen: Date;
  not_seen: boolean;
  affected_url: string | null;
  latest_rule_id: string | null;
  target_persona: TargetPersona | null;
  latest_observed_at: Date | null;
  confidence: string | null;
  evidence_count: string;
};
type EvidenceRow = {
  id: string;
  scan_id: string;
  page_id: string | null;
  project_id: string;
  kind: string;
  captured_at: Date;
  locator: string | null;
  payload: Record<string, unknown>;
  object_key: string | null;
  checksum: string | null;
  mime_type: string | null;
  retained_until: Date | null;
  verified: boolean;
  source_url: string | null;
};

const issueSelect = `select i.id, i.project_id, i.fingerprint, i.title, i.description, i.priority, i.status,
  i.version, i.first_seen, i.last_seen, i.not_seen, latest.normalized_url as affected_url,
  latest.rule_id as latest_rule_id, latest.target_persona, latest.created_at as latest_observed_at,
  latest.confidence::text as confidence,
  (select count(*) from observation_evidence c where c.observation_id = latest.id)::text as evidence_count
  from issues i left join lateral (
    select o.id, o.rule_id, o.target_persona, o.created_at, o.confidence, p.normalized_url
    from issue_observations o join scan_pages p on p.id = o.page_id
    where o.issue_id = i.id order by o.created_at desc, o.id desc limit 1
  ) latest on true`;

function mapIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    fingerprint: row.fingerprint,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    version: row.version,
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString(),
    notSeen: row.not_seen,
    affectedUrl: row.affected_url,
    latestRuleId: row.latest_rule_id,
    targetPersona: row.target_persona ?? null,
    latestObservedAt: row.latest_observed_at?.toISOString() ?? null,
    confidence: row.confidence === null ? null : Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
  };
}

export class IssueRepository {
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

  list(
    userId: string,
    projectId: string,
    options: {
      status?: string | undefined;
      priority?: string | undefined;
      ruleId?: string | undefined;
      persona?: string | undefined;
      sort: 'last_seen' | 'priority' | 'status';
      direction: 'asc' | 'desc';
      limit: number;
      offset: number;
    },
  ) {
    return this.tx(userId, async (client) => {
      const project = await client.query(
        'select id from projects where id = $1',
        [projectId],
      );
      if (!project.rowCount) return null;
      const sort = {
        last_seen: 'i.last_seen',
        priority: 'i.priority',
        status: 'i.status',
      }[options.sort];
      const result = await client.query<IssueRow>(
        `${issueSelect} where i.project_id = $1
         and ($2::text is null or i.status = $2)
         and ($3::text is null or i.priority = $3)
         and ($4::text is null or latest.rule_id = $4)
         and ($5::text is null or latest.target_persona = $5)
         order by ${sort} ${options.direction}, i.id asc limit $6 offset $7`,
        [
          projectId,
          options.status ?? null,
          options.priority ?? null,
          options.ruleId ?? null,
          options.persona ?? null,
          options.limit + 1,
          options.offset,
        ],
      );
      return {
        items: result.rows.slice(0, options.limit).map(mapIssue),
        nextOffset:
          result.rows.length > options.limit
            ? options.offset + options.limit
            : null,
      };
    });
  }

  get(userId: string, id: string): Promise<IssueDetail | null> {
    return this.tx(userId, async (client) => {
      const result = await client.query<IssueRow>(
        `${issueSelect} where i.id = $1`,
        [id],
      );
      if (!result.rows[0]) return null;
      const observations = await client.query<{
        id: string;
        scan_id: string;
        page_id: string;
        rule_id: string;
        rule_version: string;
        detected_severity: Issue['priority'];
        target_persona: TargetPersona;
        confidence: string;
        facts: Record<string, unknown>;
        explanation_snapshot: Record<string, unknown>;
        created_at: Date;
      }>(
        `select id, scan_id, page_id, rule_id, rule_version, detected_severity,
           coalesce(target_persona, 'frontend') as target_persona, confidence::text,
           facts, explanation_snapshot, created_at from issue_observations
         where issue_id = $1 order by created_at desc, id desc limit 100`,
        [id],
      );
      const ids = observations.rows.map((item) => item.id);
      const citations = ids.length
        ? await client.query<{
            observation_id: string;
            evidence_id: string;
            label: string;
            kind: 'screenshot' | 'dom' | 'console' | 'network' | 'url';
          }>(
            `select c.observation_id, c.evidence_id, c.label, e.kind from observation_evidence c
         join evidence e on e.id = c.evidence_id where c.observation_id = any($1::uuid[])
         order by c.observation_id, c.citation_order`,
            [ids],
          )
        : { rows: [] };
      const revisions = await client.query<{
        at: Date;
        editor_id: string;
        version: number;
        old_values: Record<string, unknown>;
        new_values: Record<string, unknown>;
      }>(
        'select at, editor_id, version, old_values, new_values from issue_revisions where issue_id = $1 order by version desc limit 100',
        [id],
      );
      return {
        ...mapIssue(result.rows[0]),
        observations: observations.rows.map((row) => ({
          id: row.id,
          scanId: row.scan_id,
          pageId: row.page_id,
          ruleId: row.rule_id,
          ruleVersion: row.rule_version,
          detectedSeverity: row.detected_severity,
          targetPersona: row.target_persona,
          confidence: Number(row.confidence),
          facts: row.facts,
          explanation: row.explanation_snapshot,
          createdAt: row.created_at.toISOString(),
          citations: citations.rows
            .filter((item) => item.observation_id === row.id)
            .map((item) => ({
              evidenceId: item.evidence_id,
              label: item.label,
              kind: item.kind,
            })),
        })),
        revisions: revisions.rows.map((row) => ({
          at: row.at.toISOString(),
          editorId: row.editor_id,
          version: row.version,
          oldValues: row.old_values,
          newValues: row.new_values,
        })),
      };
    });
  }

  update(
    userId: string,
    id: string,
    version: number,
    patch: Patch,
  ): Promise<'missing' | 'forbidden' | 'conflict' | 'updated'> {
    return this.tx(userId, async (client) => {
      const found = await client.query<{
        project_id: string;
        title: string;
        description: string;
        priority: string;
        status: string;
        version: number;
      }>(
        'select project_id, title, description, priority, status, version from issues where id = $1 for update',
        [id],
      );
      const row = found.rows[0];
      if (!row) return 'missing';
      const editable = await client.query<{ allowed: boolean }>(
        'select app.can_edit_project($1) as allowed',
        [row.project_id],
      );
      if (!editable.rows[0]?.allowed) return 'forbidden';
      if (row.version !== version) return 'conflict';
      const oldValues = {
        title: row.title,
        description: row.description,
        priority: row.priority,
        status: row.status,
      };
      const newValues = { ...oldValues, ...patch };
      await client.query(
        `update issues set title = $2, description = $3, priority = $4, status = $5,
         version = version + 1, updated_at = now() where id = $1`,
        [
          id,
          newValues.title,
          newValues.description,
          newValues.priority,
          newValues.status,
        ],
      );
      await client.query(
        `insert into issue_revisions (issue_id, editor_id, old_values, new_values, change_reason, version)
         values ($1,$2,$3,$4,'user edit',$5)`,
        [
          id,
          userId,
          JSON.stringify(oldValues),
          JSON.stringify(newValues),
          version + 1,
        ],
      );
      return 'updated';
    });
  }

  evidence(
    userId: string,
    id: string,
  ): Promise<(EvidenceRow & { ruleIds: string[]; issueIds: string[] }) | null> {
    return this.tx(userId, async (client) => {
      const result = await client.query<EvidenceRow>(
        `select e.id, e.scan_id, e.page_id, s.project_id, e.kind, e.captured_at, e.locator,
           e.payload, e.object_key, e.checksum, e.mime_type, e.retained_until, e.verified,
           p.normalized_url as source_url
         from evidence e join scans s on s.id = e.scan_id
         left join scan_pages p on p.id = e.page_id where e.id = $1`,
        [id],
      );
      if (!result.rows[0]) return null;
      const linked = await client.query<{ rule_id: string; issue_id: string }>(
        `select distinct o.rule_id, o.issue_id from observation_evidence c
         join issue_observations o on o.id = c.observation_id where c.evidence_id = $1`,
        [id],
      );
      return {
        ...result.rows[0],
        ruleIds: [...new Set(linked.rows.map((row) => row.rule_id))],
        issueIds: [...new Set(linked.rows.map((row) => row.issue_id))],
      };
    });
  }
}
