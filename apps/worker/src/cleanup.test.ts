import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { pruneExpiredArtifacts } from './cleanup.js';
import type { ArtifactStore } from './artifact-store.js';

describe('artifact retention cleanup', () => {
  it('identifies and purges expired artifacts safely', async () => {
    const removedKeys: string[] = [];
    const mockStore: ArtifactStore = {
      put: async () => {
        throw new Error('Not implemented');
      },
      remove: async (key: string) => {
        removedKeys.push(key);
      },
    };

    const mockPool = {
      connect: async () => ({
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes('get_expired_evidence_artifacts')) {
            return {
              rows: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  scan_id: '22222222-2222-4222-8222-222222222222',
                  object_key:
                    '22222222-2222-4222-8222-222222222222/screenshot-1.jpg',
                },
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  scan_id: '22222222-2222-4222-8222-222222222222',
                  object_key:
                    '22222222-2222-4222-8222-222222222222/screenshot-2.jpg',
                },
              ],
            };
          }
          if (sql.includes('mark_evidence_artifacts_purged')) {
            const ids = params[0] as string[];
            return { rows: [{ mark_evidence_artifacts_purged: ids.length }] };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    } as unknown as Pool;

    const result = await pruneExpiredArtifacts(mockPool, mockStore, 100);

    expect(result.scannedCount).toBe(2);
    expect(result.purgedCount).toBe(2);
    expect(result.errors).toEqual([]);
    expect(removedKeys).toEqual([
      '22222222-2222-4222-8222-222222222222/screenshot-1.jpg',
      '22222222-2222-4222-8222-222222222222/screenshot-2.jpg',
    ]);
  });

  it('handles empty results when no artifacts are expired', async () => {
    const mockStore: ArtifactStore = {
      put: async () => {
        throw new Error('Not implemented');
      },
      remove: async () => {},
    };

    const mockPool = {
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
    } as unknown as Pool;

    const result = await pruneExpiredArtifacts(mockPool, mockStore, 100);
    expect(result.scannedCount).toBe(0);
    expect(result.purgedCount).toBe(0);
  });
});
