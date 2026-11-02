import { describe, expect, it } from 'vitest';
import { scannerFindingSchema } from '@webops/contracts';
import { validateFinding } from './validate-finding.js';
import { ArtifactStore } from './artifact-store.js';

describe('proof validation', () => {
  it('rejects an accessibility finding without its screenshot and an overflow without measured widths', () => {
    const base = {
      page_url: 'https://example.com/',
      rule_id: 'MISSING_IMAGE_ALT',
      rule_version: '1',
      target: 'body > img',
      title: 'Missing alt',
      description: 'Missing alt',
      priority: 'P2',
      confidence: 1,
      observed: 'Image lacks alt',
      impact: 'Unknown image',
      reproduction_steps: ['Open page'],
      suggested_fix: 'Add alt',
      facts: { v: 1 },
      evidence: [
        { kind: 'dom', locator: 'body > img', payload: { excerpt: '<img>' } },
      ],
    };
    expect(() => validateFinding(scannerFindingSchema.parse(base))).toThrow(
      /Required proof/,
    );
    expect(() =>
      validateFinding(
        scannerFindingSchema.parse({
          ...base,
          rule_id: 'HORIZONTAL_OVERFLOW',
          evidence: [
            {
              kind: 'screenshot',
              locator: null,
              payload: { viewport: 'desktop' },
              artifact_base64: 'YWJj',
              mime_type: 'image/jpeg',
            },
          ],
        }),
      ),
    ).toThrow(/Required proof/);
  });

  it('rejects bytes that do not match a screenshot MIME type before storage', async () => {
    await expect(
      new ArtifactStore().put(
        '00000000-0000-4000-8000-000000000000',
        Buffer.from('not a JPEG').toString('base64'),
        'image/jpeg',
      ),
    ).rejects.toThrow(/signature/);
  });
});
