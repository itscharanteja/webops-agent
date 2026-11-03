import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ReportIssueSnapshotItem, Scan } from '@webops/contracts';
import { draftAuditSummary } from './audit-summary.js';

const evidenceId = randomUUID();
const item = {
  issueId: randomUUID(),
  fingerprint: 'link',
  title: 'Broken link',
  description: 'Link returned 404',
  priority: 'P1',
  status: 'open',
  ruleId: 'BROKEN_INTERNAL_LINK',
  ruleVersion: '1',
  detectedSeverity: 'P1',
  targetPersona: 'frontend',
  confidence: 1,
  facts: {},
  explanation: {
    observed: 'Link returned 404',
    suggestedFix: 'Restore the target',
  },
  evidenceIds: [evidenceId],
  citations: [],
  affectedUrl: 'https://example.com/',
} satisfies ReportIssueSnapshotItem;
const input = {
  scan: { id: randomUUID(), status: 'partial' } as Scan,
  items: [item],
  visitedCount: 1,
  skippedCount: 2,
};
describe('AI summary drafting', () => {
  it('uses model-selected findings but copies only saved facts and valid citations', async () => {
    const result = await draftAuditSummary(input, async () =>
      JSON.stringify({ selected: [0] }),
    );
    expect(result.source).toBe('bedrock');
    expect(result.overview).toContain('Coverage is incomplete');
    expect(result.highlights[0]?.observation).toBe(item.explanation.observed);
    expect(result.highlights[0]?.evidenceIds).toEqual([evidenceId]);
  });
  it.each([
    '{"selected":[24]}',
    '{"selected":[0,0]}',
    '{"selected":[0],"claims":"Certified secure"}',
    'not json',
  ])('rejects invalid model output %s', async (output) => {
    const result = await draftAuditSummary(input, async () => output);
    expect(result.source).toBe('fallback');
    expect(result.highlights).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Certified secure');
  });
  it('keeps a deterministic summary on a model error', async () => {
    expect(
      (
        await draftAuditSummary(input, async () => {
          throw new Error('Unavailable');
        })
      ).source,
    ).toBe('fallback');
  });
  it('bounds model timeouts and preserves collected facts', async () => {
    vi.useFakeTimers();
    try {
      const work = draftAuditSummary(input, () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(12001);
      const result = await work;
      expect(result.source).toBe('fallback');
      expect(result.highlights[0]?.issueId).toBe(item.issueId);
    } finally {
      vi.useRealTimers();
    }
  });
  it('sends redacted facts and does not invoke the model without usable evidence', async () => {
    const model = vi.fn(async (prompt: string) => {
      expect(prompt).not.toContain('sensitive-token');
      return '{"selected":[0]}';
    });
    await draftAuditSummary(
      {
        ...input,
        items: [
          {
            ...item,
            explanation: {
              observed: 'GET https://example.com/path?token=sensitive-token',
            },
          },
        ],
      },
      model,
    );
    model.mockClear();
    const result = await draftAuditSummary(
      { ...input, items: [{ ...item, evidenceIds: [] }] },
      model,
    );
    expect(model).not.toHaveBeenCalled();
    expect(result.highlights).toEqual([]);
  });
});
