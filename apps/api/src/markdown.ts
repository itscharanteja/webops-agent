import type { IssueDetail } from '@webops/contracts';

function inline(value: string): string {
  return value
    .replace(/[\r\n\u0000-\u001f]+/g, ' ')
    .replace(/[\\`*_{}\[\]()#+.!|<>-]/g, '\\$&')
    .trim();
}
function paragraph(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => inline(line))
    .join('  \n');
}

export function markdownFilename(issue: IssueDetail): string {
  const slug = issue.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `issue-${issue.id}${slug ? `-${slug}` : ''}.md`;
}

export function issueMarkdown(issue: IssueDetail, webOrigin: string): string {
  const latest = issue.observations[0];
  const explanation = latest?.explanation ?? {};
  const observed =
    typeof explanation.observed === 'string'
      ? explanation.observed
      : 'Observation unavailable';
  const impact =
    typeof explanation.impact === 'string'
      ? explanation.impact
      : 'Impact unavailable';
  const fix =
    typeof explanation.suggestedFix === 'string'
      ? explanation.suggestedFix
      : 'Suggested fix unavailable';
  const steps = Array.isArray(explanation.reproductionSteps)
    ? explanation.reproductionSteps.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  const proof =
    latest?.citations.map(
      (citation) =>
        `- [${inline(citation.label)}](${webOrigin}/projects/${issue.projectId}/scans/${latest.scanId}/evidence/${citation.evidenceId})`,
    ) ?? [];
  return [
    `# ${inline(issue.title)}`,
    '',
    `- Priority: ${issue.priority}`,
    `- Status: ${issue.status}`,
    `- Affected URL: ${inline(issue.affectedUrl ?? 'Unavailable')}`,
    `- Latest scan: ${latest?.scanId ?? 'Unavailable'}`,
    `- Observation time: ${latest?.createdAt ?? 'Unavailable'}`,
    `- Rule/check ID: ${latest?.ruleId ?? 'Unavailable'} (version ${latest?.ruleVersion ?? 'unknown'})`,
    `- Confidence: ${latest?.confidence ?? 'Unavailable'}`,
    '',
    '## Description',
    '',
    paragraph(issue.description),
    '',
    '## Exact observation',
    '',
    paragraph(observed),
    '',
    '## Impact',
    '',
    paragraph(impact),
    '',
    '## Reproduction steps',
    '',
    ...steps.map((step, index) => `${index + 1}. ${inline(step)}`),
    '',
    '## Suggested fix',
    '',
    paragraph(fix),
    '',
    '## Proof',
    '',
    ...proof,
    '',
  ].join('\n');
}
