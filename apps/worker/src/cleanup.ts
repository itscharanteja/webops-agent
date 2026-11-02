import type { Pool } from 'pg';
import type { ArtifactStore } from './artifact-store.js';

export type PruneResult = {
  scannedCount: number;
  purgedCount: number;
  errors: string[];
};

export async function pruneExpiredArtifacts(
  pool: Pool,
  artifactStore: ArtifactStore,
  limit = 500,
): Promise<PruneResult> {
  const client = await pool.connect();
  const errors: string[] = [];
  try {
    const expired = await client.query<{
      id: string;
      scan_id: string;
      object_key: string;
    }>(
      'select id, scan_id, object_key from app.get_expired_evidence_artifacts($1)',
      [limit],
    );

    if (!expired.rows.length) {
      return { scannedCount: 0, purgedCount: 0, errors: [] };
    }

    const purgedIds: string[] = [];
    for (const row of expired.rows) {
      try {
        await artifactStore.remove(row.object_key);
        purgedIds.push(row.id);
      } catch (err) {
        errors.push(
          `Failed to remove artifact ${row.object_key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let purgedCount = 0;
    if (purgedIds.length > 0) {
      const result = await client.query<{
        mark_evidence_artifacts_purged: number;
      }>('select app.mark_evidence_artifacts_purged($1)', [purgedIds]);
      purgedCount = Number(
        result.rows[0]?.mark_evidence_artifacts_purged ?? purgedIds.length,
      );
    }

    return {
      scannedCount: expired.rows.length,
      purgedCount,
      errors,
    };
  } finally {
    client.release();
  }
}
