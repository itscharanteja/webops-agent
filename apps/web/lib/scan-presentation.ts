import type { ReportIssueSnapshotItem, Scan } from '@webops/contracts';

export const disciplines = [
  { value: 'all', label: 'All disciplines' },
  { value: 'ui_ux', label: 'Design & UX' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend & SRE' },
  { value: 'content_seo', label: 'Content & SEO' },
];
export function scanSummary(
  status: Scan['status'],
  count: number,
  hasReport: boolean,
) {
  if (status === 'queued') return 'Scan queued';
  if (status === 'running') return 'Scan in progress · Coverage is incomplete';
  if (status !== 'completed') return `Scan ${status} · Coverage is incomplete`;
  if (!hasReport) return 'Scan completed · Report unavailable';
  return count === 0
    ? 'No issues found on the checked pages'
    : `${count} findings on the checked pages`;
}
export function citations(item: ReportIssueSnapshotItem) {
  return item.citations?.length
    ? item.citations
    : (item.evidenceIds ?? []).map((evidenceId, index) => ({
        evidenceId,
        label: `Evidence ${index + 1}`,
        kind: 'url' as const,
      }));
}
export function fact(item: ReportIssueSnapshotItem, ...keys: string[]): string {
  for (const key of keys) {
    const value = item.explanation[key] ?? item.facts[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}
export function steps(item: ReportIssueSnapshotItem): string[] {
  const value =
    item.explanation.reproductionSteps ?? item.explanation.reproduction_steps;
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === 'string')
    : [];
}
const md = (s: string) =>
  s.replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&').replace(/\r?\n/g, ' ');
export function reportMarkdown(
  scan: Scan,
  items: ReportIssueSnapshotItem[],
  coverage: {
    visitedUrls: string[];
    skipped: { url: string; reason: string }[];
    limitations: string[];
  },
  origin: string,
  projectId: string,
) {
  return [
    '# Scan report',
    `Scan: ${scan.id}`,
    `Status: ${scan.status}`,
    `Date: ${scan.finishedAt ?? scan.queuedAt}`,
    scanSummary(scan.status, items.length, true),
    `Pages checked: ${coverage.visitedUrls.length}. Skipped URLs: ${coverage.skipped.length}. Findings in this export: ${items.length}.`,
    '## Coverage limitations',
    ...coverage.limitations.map((s) => `- ${md(s)}`),
    ...coverage.skipped.map((s) => `- ${md(s.url)}: ${md(s.reason)}`),
    '## Issues',
    ...items.flatMap((item) => [
      `### ${md(item.title)}`,
      `Priority: ${item.priority} · Status: ${item.status}`,
      `URL: ${md(item.affectedUrl ?? 'Unavailable')}`,
      `Rule: ${md(item.ruleId)} v${md(item.ruleVersion)} · Confidence: ${Math.round(item.confidence * 100)}%`,
      `Observation: ${md(fact(item, 'observed') || item.description)}`,
      `Impact: ${md(fact(item, 'impact') || 'Not recorded')}`,
      'Reproduction:',
      ...steps(item).map((s, i) => `${i + 1}. ${md(s)}`),
      `Suggested fix: ${md(fact(item, 'suggestedFix', 'suggested_fix') || 'Not recorded')}`,
      ...citations(item).map(
        (c) =>
          `[${md(c.label)}](${origin}/projects/${projectId}/scans/${scan.id}/evidence/${c.evidenceId})`,
      ),
    ]),
    '## Visited URLs',
    ...coverage.visitedUrls.map((s) => `- ${md(s)}`),
  ].join('\n\n');
}

export function citedSummaries(items: ReportIssueSnapshotItem[]) {
  return items
    .filter((item) => {
      const summary = item.explanation.summary;
      const ids = item.explanation.cited_evidence_ids;
      return (
        typeof summary === 'string' &&
        summary.trim().length > 0 &&
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.every(
          (id) =>
            typeof id === 'string' &&
            citations(item).some((c) => c.evidenceId === id),
        )
      );
    })
    .slice(0, 3);
}

export function scanNavigation(
  status: Scan['status'] | undefined,
  requested: string | null,
) {
  const running = status === 'queued' || status === 'running';
  return { running, activeTab: running ? 'events' : requested };
}
