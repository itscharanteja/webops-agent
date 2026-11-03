'use client';

import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  PasswordInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type {
  Project,
  ProjectDiscordConfig,
  ReportIssueSnapshotItem,
  Scan,
} from '@webops/contracts';
import {
  auditSummaryDraftSchema,
  type AuditSummaryDraft,
} from '@webops/contracts';
import { apiFetch } from '../lib/client';
import {
  citedSummaries,
  disciplines,
  fact,
  reportMarkdown,
} from '../lib/scan-presentation';

const tracks = disciplines.filter((d) => d.value !== 'all');
const filenames: Record<string, string> = {
  frontend: 'frontend.md',
  backend: 'backend.md',
  ui_ux: 'design-ux.md',
  content_seo: 'content-seo.md',
};
const webhookFields = [
  { key: 'frontendWebhookUrl', label: 'Frontend' },
  { key: 'backendWebhookUrl', label: 'Backend & SRE' },
  { key: 'uiUxWebhookUrl', label: 'Design & UX' },
  { key: 'contentSeoWebhookUrl', label: 'Content & SEO' },
  { key: 'defaultWebhookUrl', label: 'Default channel' },
] as const;
export const coreChecks = [
  'HTTP_PAGE_ERROR',
  'BROKEN_INTERNAL_LINK',
  'JS_CONSOLE_ERROR',
  'FAILED_FIRST_PARTY_REQUEST',
  'MISSING_IMAGE_ALT',
  'UNLABELED_FORM_CONTROL',
  'MISSING_PAGE_TITLE',
  'HORIZONTAL_OVERFLOW',
];
const checkLabels: Record<string, string> = {
  HTTP_PAGE_ERROR: 'Page responses',
  BROKEN_INTERNAL_LINK: 'Internal links',
  JS_CONSOLE_ERROR: 'JavaScript errors',
  FAILED_FIRST_PARTY_REQUEST: 'First-party requests',
  MISSING_IMAGE_ALT: 'Image alternative text',
  UNLABELED_FORM_CONTROL: 'Form labels',
  MISSING_PAGE_TITLE: 'Page titles',
  HORIZONTAL_OVERFLOW: 'Horizontal overflow',
  VISUAL_OVERLAP_CLIPPING: 'Overlapping controls',
};
export function CheckTable({
  findings,
  onReview,
}: {
  findings: ReportIssueSnapshotItem[];
  onReview: (rule: string) => void;
}) {
  return (
    <Table.ScrollContainer minWidth={440}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Check</Table.Th>
            <Table.Th>Findings</Table.Th>
            <Table.Th>Action</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[
            ...coreChecks,
            ...Array.from(new Set(findings.map((i) => i.ruleId))).filter(
              (r) => !coreChecks.includes(r),
            ),
          ].map((rule) => {
            const count = findings.filter((i) => i.ruleId === rule).length;
            return (
              <Table.Tr key={rule}>
                <Table.Td>
                  <Text size="sm">{checkLabels[rule] ?? rule}</Text>
                  <Text size="xs" c="dimmed">
                    {rule}
                  </Text>
                </Table.Td>
                <Table.Td>{count}</Table.Td>
                <Table.Td>
                  {count > 0 ? (
                    <Anchor
                      component="button"
                      size="xs"
                      onClick={() => onReview(rule)}
                    >
                      Review
                    </Anchor>
                  ) : (
                    <Text size="xs" c="dimmed">
                      No findings
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
export default function ScanOverview({
  scan,
  project,
  findings,
  coverage,
  summary,
  onProjectUpdate,
  onReview,
  onLimitations,
  children,
}: {
  scan: Scan;
  project: Project | null;
  findings: ReportIssueSnapshotItem[];
  coverage: {
    visitedUrls: string[];
    skipped: { url: string; reason: string }[];
    limitations: string[];
  };
  summary: Record<string, unknown>;
  onProjectUpdate: (p: Project) => void;
  onReview: (rule?: string) => void;
  onLimitations: () => void;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<AuditSummaryDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  async function createDraft() {
    setDrafting(true);
    setDraftError('');
    try {
      const result = auditSummaryDraftSchema.parse(
        await apiFetch(`/v1/scans/${scan.id}/summary-draft`, {
          method: 'POST',
        }),
      );
      const allowed = new Set(
        findings.flatMap((i) => [
          ...i.evidenceIds,
          ...i.citations.map((c) => c.evidenceId),
        ]),
      );
      if (
        result.scanId !== scan.id ||
        result.highlights.some((h) =>
          h.evidenceIds.some((e) => !allowed.has(e)),
        )
      )
        throw new Error('Draft contains unsupported citations');
      setDraft(result);
    } catch (cause) {
      setDraftError(
        cause instanceof Error ? cause.message : 'Could not draft summary',
      );
    } finally {
      setDrafting(false);
    }
  }
  const [rawExpanded, setRawExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webhooks, setWebhooks] = useState<ProjectDiscordConfig>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const counts = tracks.map((t) => ({
    ...t,
    count: findings.filter((i) => i.targetPersona === t.value).length,
  }));
  // Present only stored enrichment with citations belonging to this finding.
  const enriched = citedSummaries(findings);
  const focus = Array.from(
    new Set(
      [...findings]
        .sort((a, b) => a.priority.localeCompare(b.priority))
        .map((i) => i.ruleId),
    ),
  ).slice(0, 3);
  const raw = JSON.stringify(summary, null, 2);
  function openSettings() {
    setWebhooks({ ...project?.discordWebhooks });
    setSettingsError('');
    setSettingsOpen(true);
  }
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSettingsError('');
    try {
      const updated: Project = await apiFetch(
        `/v1/projects/${scan.projectId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ discordWebhooks: webhooks }),
        },
      );
      onProjectUpdate(updated);
      setSettingsOpen(false);
      setFeedback({ error: false, text: 'Webhook settings updated.' });
    } catch (cause) {
      setSettingsError(
        cause instanceof Error
          ? cause.message
          : 'Could not save webhook settings',
      );
    } finally {
      setSaving(false);
    }
  }
  async function push(persona: string) {
    if (busy) return;
    setBusy(persona);
    setFeedback(null);
    try {
      const result = await apiFetch(`/v1/scans/${scan.id}/dispatch-discord`, {
        method: 'POST',
        body: JSON.stringify({ persona }),
      });
      setFeedback({
        error: false,
        text:
          result.message ||
          `Sent to ${tracks.find((t) => t.value === persona)?.label}.`,
      });
    } catch (cause) {
      setFeedback({
        error: true,
        text:
          cause instanceof Error ? cause.message : 'Could not send to Discord',
      });
    } finally {
      setBusy(null);
    }
  }
  function downloadTrack(persona: string) {
    const items = findings.filter((i) => i.targetPersona === persona);
    const content = reportMarkdown(
      scan,
      items,
      coverage,
      window.location.origin,
      scan.projectId,
    );
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/markdown;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = filenames[persona] ?? `${persona}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback({
      error: false,
      text: `Downloaded ${filenames[persona]} · ${items.length} findings.`,
    });
  }
  function configured(persona: string) {
    const key =
      persona === 'frontend'
        ? 'frontendWebhookUrl'
        : persona === 'backend'
          ? 'backendWebhookUrl'
          : persona === 'ui_ux'
            ? 'uiUxWebhookUrl'
            : 'contentSeoWebhookUrl';
    return !!(
      project?.discordWebhooks?.[key] ||
      project?.discordWebhooks?.defaultWebhookUrl
    );
  }
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed">
            SCAN OVERVIEW
          </Text>
          <Title order={2}>From findings to next steps</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Review the audit, pick a discipline, and share the work.
          </Text>
        </div>
        <Group gap="xs" className="screen-only">
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button variant="default">Download ▾</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Markdown by discipline</Menu.Label>
              {counts.map((t) => (
                <Menu.Item key={t.value} onClick={() => downloadTrack(t.value)}>
                  {filenames[t.value]} · {t.count}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button loading={!!busy} disabled={!project}>
                Push to Discord ▾
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Send this scan to a channel</Menu.Label>
              {counts.map((t) => (
                <Menu.Item
                  key={t.value}
                  disabled={!!busy || !configured(t.value)}
                  onClick={() => void push(t.value)}
                >
                  To {t.label}
                  {!configured(t.value) ? ' · Configure webhook' : ''}
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item onClick={openSettings}>
                Update webhook settings
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button variant="subtle" onClick={openSettings} disabled={!project}>
            Webhook settings
          </Button>
        </Group>
      </Group>
      {feedback && (
        <Alert
          role={feedback.error ? 'alert' : 'status'}
          color={feedback.error ? 'red' : 'green'}
          withCloseButton
          onClose={() => setFeedback(null)}
        >
          {feedback.text}
          {feedback.error && (
            <Button variant="subtle" size="xs" onClick={openSettings}>
              Update webhooks
            </Button>
          )}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <section className="audit-summary">
          <Group justify="space-between">
            <Title order={3} size="md">
              AI drafted summary
            </Title>
            <Badge variant="light" color="gray">
              {draft?.source === 'bedrock'
                ? 'AI draft'
                : draft
                  ? 'Deterministic fallback'
                  : enriched.length
                    ? 'Saved explanations'
                    : 'Scan facts'}
            </Badge>
          </Group>
          <Text size="sm" mt="sm">
            {findings.length} findings across {coverage.visitedUrls.length}{' '}
            checked pages.{' '}
            {findings.filter((i) => ['P0', 'P1'].includes(i.priority)).length}{' '}
            are marked P0 or P1.
            {scan.status !== 'completed' ? ' Coverage is incomplete.' : ''}
          </Text>
          <Group mt="sm">
            <Button
              size="xs"
              variant="default"
              loading={drafting}
              onClick={() => void createDraft()}
            >
              {draft ? 'Refresh AI draft' : 'Draft AI summary'}
            </Button>
            {draft && (
              <Text size="xs" c="dimmed">
                Drafted {new Date(draft.generatedAt).toLocaleTimeString()}
              </Text>
            )}
          </Group>
          {draftError && (
            <Alert color="red" role="alert" mt="sm">
              {draftError}
            </Alert>
          )}
          {draft ? (
            <div>
              {draft.limitation && (
                <Text size="xs" c="dimmed" mt="sm">
                  {draft.limitation}
                </Text>
              )}
              {draft.highlights.map((item, index) => (
                <div
                  className="audit-summary-entry"
                  key={`${item.issueId}-${index}`}
                >
                  <Text fw={600} size="sm">
                    {item.title}
                  </Text>
                  <Text size="sm" mt={4}>
                    {item.observation}
                  </Text>
                  <Text size="xs" c="dimmed" mt={4}>
                    Next step: {item.suggestedFix}
                  </Text>
                  <Group mt={4} gap="xs">
                    {item.evidenceIds.map((e) => (
                      <Anchor
                        key={e}
                        size="xs"
                        href={`/projects/${scan.projectId}/scans/${scan.id}/evidence/${e}`}
                      >
                        Evidence {item.evidenceIds.indexOf(e) + 1}
                      </Anchor>
                    ))}
                  </Group>
                </div>
              ))}
            </div>
          ) : (
            <>
              {enriched.length ? (
                enriched.map((item) => (
                  <div key={item.fingerprint} className="audit-summary-entry">
                    <Text size="sm">{String(item.explanation.summary)}</Text>
                    <Anchor
                      size="xs"
                      href={`/projects/${scan.projectId}/scans/${scan.id}/evidence/${String((item.explanation.cited_evidence_ids as string[])[0])}`}
                    >
                      View supporting evidence
                    </Anchor>
                  </div>
                ))
              ) : (
                <Text size="xs" c="dimmed" mt="xs">
                  Draft a summary to prioritize recorded findings using AI.
                  Until then, the overview shows scan facts.
                </Text>
              )}
            </>
          )}
          <Group gap="xs" mt="md">
            {['P0', 'P1', 'P2', 'P3'].map((p) => (
              <Badge
                key={p}
                variant="light"
                color={['P0', 'P1'].includes(p) ? 'orange' : 'gray'}
              >
                {p}: {findings.filter((i) => i.priority === p).length}
              </Badge>
            ))}
          </Group>
          <Button variant="light" mt="md" size="xs" onClick={() => onReview()}>
            Review findings
          </Button>
        </section>
        <section className="audit-summary">
          <Group justify="space-between">
            <Title order={3} size="md">
              Raw summary
            </Title>
            <Text size="xs" c="dimmed">
              Saved report data
            </Text>
          </Group>
          <Text size="sm" c="dimmed" mt="sm">
            The original summary recorded at scan completion.
          </Text>
          <pre
            id="raw-scan-summary"
            className={`audit-raw-summary ${rawExpanded ? 'expanded' : ''}`}
          >
            {raw}
          </pre>
          <Button
            variant="subtle"
            size="xs"
            aria-expanded={rawExpanded}
            aria-controls="raw-scan-summary"
            onClick={() => setRawExpanded((v) => !v)}
          >
            {rawExpanded ? 'Show less' : 'Show full summary'}
          </Button>
          <Group gap="xs" mt="md">
            <Badge color="gray" variant="light">
              {coverage.skipped.length} skipped
            </Badge>
            <Badge color="gray" variant="light">
              {coverage.limitations.length} limitations
            </Badge>
          </Group>
          <Anchor component="button" size="xs" mt="xs" onClick={onLimitations}>
            Review coverage limitations
          </Anchor>
        </section>
      </SimpleGrid>
      {focus.length > 0 && (
        <section>
          <Group justify="space-between" mb="sm">
            <Title order={3} size="md">
              Where to start
            </Title>
            <Text size="xs" c="dimmed">
              Highest-priority checks first
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {focus.map((rule) => {
              const item = findings.find((i) => i.ruleId === rule)!;
              return (
                <button
                  className="audit-focus"
                  key={rule}
                  onClick={() => onReview(rule)}
                >
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      {checkLabels[rule] ?? rule}
                    </Text>
                    <Badge color="gray" variant="light">
                      {findings.filter((i) => i.ruleId === rule).length}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" lineClamp={2} mt="xs">
                    {fact(item, 'suggestedFix', 'suggested_fix') ||
                      'Review the observation and its supporting evidence.'}
                  </Text>
                  <Text size="xs" mt="sm" c="blue">
                    Review findings →
                  </Text>
                </button>
              );
            })}
          </SimpleGrid>
        </section>
      )}
      <section>
        <Title order={3} size="md" mb="xs">
          Checks
        </Title>
        <Text size="xs" c="dimmed" mb="sm">
          Results from checked pages. Zero findings does not establish full-site
          compliance.
        </Text>
        <CheckTable findings={findings} onReview={onReview} />
      </section>
      {children}
      <Modal
        opened={settingsOpen}
        onClose={() => !saving && setSettingsOpen(false)}
        title="Webhook settings"
        centered
      >
        <form onSubmit={saveSettings}>
          <Stack>
            <Text size="sm" c="dimmed">
              Choose where each discipline is sent. The default channel is used
              when its discipline has no webhook.
            </Text>
            {webhookFields.map((field) => (
              <PasswordInput
                key={field.key}
                label={`${field.label} webhook URL`}
                autoComplete="off"
                placeholder="https://discord.com/api/webhooks/…"
                value={webhooks[field.key] ?? ''}
                onChange={(e) => {
                  const value = e.currentTarget.value.trim();
                  setWebhooks((previous) => ({
                    ...previous,
                    [field.key]: value || undefined,
                  }));
                }}
              />
            ))}
            {settingsError && (
              <Alert color="red" role="alert">
                {settingsError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={saving}
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save webhooks
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
