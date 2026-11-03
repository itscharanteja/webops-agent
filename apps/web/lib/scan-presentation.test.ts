import { describe, expect, it } from 'vitest';
import type { ReportIssueSnapshotItem, Scan } from '@webops/contracts';
import {
  citedSummaries,
  reportMarkdown,
  scanSummary,
  scanNavigation,
} from './scan-presentation';

describe('scan presentation', () => {
  it.each(['partial', 'failed', 'cancelled'] as const)(
    'never presents %s coverage as clean',
    (status) => {
      expect(scanSummary(status, 0, true)).toContain('Coverage is incomplete');
      expect(scanSummary(status, 372, true)).not.toContain('completed');
    },
  );
  it('requires a saved report before presenting zero findings', () => {
    expect(scanSummary('completed', 0, false)).toContain('Report unavailable');
    expect(scanSummary('completed', 0, true)).toBe(
      'No issues found on the checked pages',
    );
    expect(scanSummary('running', 0, false)).toContain('incomplete');
  });
  it('exports saved facts, escaped titles, coverage and stable proof routes', () => {
    const scan = {
      id: 'scan-1',
      status: 'partial',
      queuedAt: '2026-11-03T10:00:00Z',
      finishedAt: null,
    } as Scan;
    const item = {
      title: '<script>\n# injected',
      priority: 'P1',
      status: 'open',
      ruleId: 'HTTP_PAGE_ERROR',
      ruleVersion: '1',
      confidence: 1,
      description: 'Saved observation',
      affectedUrl: 'https://example.com',
      explanation: {
        impact: 'Page unavailable',
        suggestedFix: 'Restore route',
        reproductionSteps: ['Open route'],
      },
      facts: {},
      evidenceIds: ['proof-1'],
      citations: [],
    } as unknown as ReportIssueSnapshotItem;
    const content = reportMarkdown(
      scan,
      [item],
      {
        visitedUrls: ['https://example.com'],
        skipped: [],
        limitations: ['Timeout'],
      },
      'http://localhost:3000',
      'project-1',
    );
    expect(content).toContain('Coverage is incomplete');
    expect(content).toContain('Saved observation');
    expect(content).toContain('Restore route');
    expect(content).toContain(
      '/projects/project-1/scans/scan-1/evidence/proof-1',
    );
    expect(content).not.toContain('<script>');
    expect(content).not.toContain('\n# injected');
    expect(content).not.toMatch(/cryptograph|certification|legal exposure/i);
  });
});

describe('stored audit summaries', () => {
  it('shows only nonblank summaries citing evidence attached to their finding', () => {
    const sample = (summary: string, ids: string[]) =>
      ({
        explanation: { summary, cited_evidence_ids: ids },
        citations: [],
        evidenceIds: ['proof-1'],
      }) as unknown as ReportIssueSnapshotItem;
    const accepted = sample('Recorded explanation', ['proof-1']);
    expect(
      citedSummaries([
        sample('Uncited', []),
        sample('Invented citation', ['other-proof']),
        sample('  ', ['proof-1']),
        accepted,
      ]),
    ).toEqual([accepted]);
  });
});

describe('scan navigation', () => {
  it.each(['queued', 'running'] as const)(
    'locks %s scans to the terminal even when another tab was selected',
    (status) => {
      expect(scanNavigation(status, 'overview')).toEqual({
        running: true,
        activeTab: 'events',
      });
      expect(scanNavigation(status, 'issues').activeTab).toBe('events');
    },
  );
  it.each(['completed', 'partial', 'failed', 'cancelled'] as const)(
    'unlocks results for ended %s scans',
    (status) => {
      expect(scanNavigation(status, 'overview')).toEqual({
        running: false,
        activeTab: 'overview',
      });
    },
  );
});
