'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Container,
  Drawer,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type {
  Project,
  ReportIssueSnapshotItem,
  Scan,
  ScanEvent,
  ScanPage,
} from '@webops/contracts';
import ScanOverview, { CheckTable } from './scan-overview';
import { apiFetch, apiStream } from '../lib/client';
import {
  citations,
  disciplines,
  fact,
  reportMarkdown,
  scanSummary,
  scanNavigation,
  steps,
} from '../lib/scan-presentation';

type Report = {
  summary: Record<string, unknown>;
  coverage: {
    visitedUrls: string[];
    skipped: { url: string; reason: string }[];
    failedCount: number;
    limitations: string[];
  };
  issueSnapshot: ReportIssueSnapshotItem[];
  createdAt: string;
};
const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);
const pageSize = 10;
function download(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/markdown;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ScanWorkspace({
  activity = false,
}: {
  activity?: boolean;
}) {
  const { id, scanId } = useParams<{ id: string; scanId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [pagesOffset, setPagesOffset] = useState(0);
  const [pagesNext, setPagesNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [reportError, setReportError] = useState('');
  const [connection, setConnection] = useState('Connecting…');
  const [tab, setTab] = useState<string | null>(
    activity ? 'events' : 'overview',
  );
  const [query, setQuery] = useState('');
  const [discipline, setDiscipline] = useState<string | null>('all');
  const [level, setLevel] = useState<string | null>('all');
  const [page, setPage] = useState(1);
  const [follow, setFollow] = useState(true);
  const [selected, setSelected] = useState<ReportIssueSnapshotItem | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDiscipline, setExportDiscipline] = useState<string | null>(
    'all',
  );
  const [format, setFormat] = useState<string | null>('markdown');
  const [cancelling, setCancelling] = useState(false);
  const seq = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    seq.current = 0;
    setEvents([]);
    setReport(null);
    setScan(null);
    setError('');
    const refresh = async () => {
      try {
        const current: Scan = await apiFetch(`/v1/scans/${scanId}`, {
          signal: controller.signal,
        });
        if (stopped) return;
        setScan(current);
        setError('');
        if (terminal.has(current.status)) {
          try {
            const saved: Report = await apiFetch(`/v1/scans/${scanId}/report`, {
              signal: controller.signal,
            });
            if (!stopped) {
              setReport(saved);
              setReportError('');
            }
          } catch (cause) {
            if (!stopped)
              setReportError(
                cause instanceof Error ? cause.message : 'Report unavailable',
              );
          }
        }
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error ? cause.message : 'Could not load scan',
          );
      }
    };
    void apiFetch(`/v1/projects/${id}`, { signal: controller.signal })
      .then((p) => {
        if (!stopped) setProject(p);
      })
      .catch((cause) => {
        if (!stopped) setError(cause.message);
      });
    void refresh();
    const poll = setInterval(() => void refresh(), 4000);
    const watch = async () => {
      try {
        const response = await apiStream(
          `/v1/scans/${scanId}/events`,
          seq.current,
          controller.signal,
        );
        if (!response.ok || !response.body)
          throw new Error('Event stream unavailable');
        if (!stopped) setConnection('Connected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let ended = false;
        while (!stopped) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder
            .decode(part.value, { stream: true })
            .replace(/\r/g, '');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (!data) continue;
            const event: ScanEvent = JSON.parse(data.slice(6));
            if (event.scanId !== scanId || event.seq <= seq.current) continue;
            seq.current = event.seq;
            setEvents((previous) => [...previous, event]);
            if (event.payload.terminal === true) ended = true;
          }
          if (ended) {
            await reader.cancel();
            break;
          }
        }
        if (ended) {
          if (!stopped) {
            setConnection('Event history loaded');
            void refresh();
          }
          return;
        }
      } catch {
        /* Replay starts after the last received sequence. */
      }
      if (!stopped) {
        setConnection('Reconnecting…');
        retry = setTimeout(() => void watch(), 1000);
      }
    };
    void watch();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(poll);
      clearTimeout(retry);
    };
  }, [id, scanId]);

  useEffect(() => {
    if (tab !== 'pages' || !scan || !terminal.has(scan.status)) return;
    const controller = new AbortController();
    void apiFetch(
      `/v1/scans/${scanId}/pages?limit=${pageSize}&offset=${pagesOffset}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setPages(data.items);
        setPagesNext(data.nextOffset);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [scanId, tab, pagesOffset, scan?.visitedCount]);

  const findings = (report?.issueSnapshot ?? []).filter(
    (item) => citations(item).length > 0,
  );
  const filtered = findings
    .filter(
      (i) =>
        (discipline === 'all' || i.targetPersona === discipline) &&
        `${i.title} ${i.affectedUrl} ${i.ruleId}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.priority.localeCompare(b.priority));
  const filteredEvents = events.filter(
    (e) =>
      (level === 'all' || e.level === level) &&
      `${e.message} ${e.phase}`.toLowerCase().includes(query.toLowerCase()),
  );
  const skipped = (report?.coverage.skipped ?? []).filter((s) =>
    `${s.url} ${s.reason}`.toLowerCase().includes(query.toLowerCase()),
  );
  const { running, activeTab } = scanNavigation(scan?.status, tab);
  useEffect(() => {
    if (follow && terminalRef.current)
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [events, follow, activeTab, query, level]);
  function changeTab(value: string | null) {
    if (running && value !== 'events') return;
    setTab(value);
    setPage(1);
    setQuery('');
  }
  const proofLink = (evidenceId: string) =>
    `/projects/${id}/scans/${scanId}/evidence/${evidenceId}`;
  async function cancel() {
    setCancelling(true);
    try {
      setScan(await apiFetch(`/v1/scans/${scanId}/cancel`, { method: 'POST' }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not cancel scan',
      );
    } finally {
      setCancelling(false);
    }
  }
  function pager(count: number, current = page, onChange = setPage) {
    return (
      <Group justify="space-between" mt="md" className="screen-only">
        <Text size="xs" c="dimmed">
          {count ? (current - 1) * pageSize + 1 : 0}–
          {Math.min(current * pageSize, count)} of {count}
        </Text>
        <Pagination
          size="sm"
          total={Math.max(1, Math.ceil(count / pageSize))}
          value={current}
          onChange={onChange}
          aria-label="Dataset pagination"
        />
      </Group>
    );
  }
  const exportItems = findings.filter(
    (i) => exportDiscipline === 'all' || i.targetPersona === exportDiscipline,
  );
  function exportReport() {
    if (!scan || !report) return;
    if (format === 'pdf') {
      setExportOpen(false);
      setTimeout(() => window.print(), 100);
      return;
    }
    download(
      `scan-${scanId}-${exportDiscipline}.md`,
      reportMarkdown(
        scan,
        exportItems,
        report.coverage,
        window.location.origin,
        id,
      ),
    );
    setExportOpen(false);
  }
  const classification = events.find(
    (e) => e.phase === 'taxonomy' && typeof e.payload.category === 'string',
  );
  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" className="screen-only">
          <Group>
            <Anchor component={Link} href={`/projects/${id}`}>
              {project?.name ?? 'Project'}
            </Anchor>
            <Text size="sm" c="dimmed">
              / Scan {scanId.slice(0, 8)}
            </Text>
          </Group>
          {!running && (
            <Group>
              <Button
                variant="default"
                component={Link}
                href={`/projects/${id}/issues`}
                disabled={running}
              >
                Issues board
              </Button>
              <Button
                variant="default"
                component={Link}
                href={`/projects/${id}/reports`}
                disabled={running}
              >
                Reports
              </Button>
              <Button
                disabled={running || !report}
                onClick={() => setExportOpen(true)}
              >
                Export
              </Button>
            </Group>
          )}
        </Group>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {!scan && !error && <Loader aria-label="Loading scan" />}
        {scan && (
          <>
            <Group justify="space-between">
              <div>
                <Group>
                  <Title order={1}>
                    {running || activity ? 'Scan activity' : 'Scan report'}
                  </Title>
                  {running && (
                    <Loader size="sm" aria-label="Scan in progress" />
                  )}
                  <Badge
                    color={
                      scan.status === 'completed'
                        ? 'green'
                        : running
                          ? 'blue'
                          : 'orange'
                    }
                  >
                    {scan.status}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed" mt={5}>
                  {project?.baseUrl} ·{' '}
                  {new Date(scan.finishedAt ?? scan.queuedAt).toLocaleString()}
                </Text>
              </div>
              {running && (
                <Button
                  color="red"
                  variant="light"
                  loading={cancelling}
                  disabled={!!scan.cancelRequestedAt}
                  onClick={cancel}
                >
                  {scan.cancelRequestedAt
                    ? 'Cancellation requested'
                    : 'Cancel scan'}
                </Button>
              )}
            </Group>
            {!running && (
              <Alert
                color={scan.status === 'completed' ? 'gray' : 'orange'}
                title={scanSummary(scan.status, findings.length, !!report)}
              >
                {scan.error ||
                  (running
                    ? 'Findings will be available after observations and evidence are saved.'
                    : scan.status === 'completed'
                      ? 'Results apply only to checked pages.'
                      : 'Collected results are retained. Unchecked pages may contain additional issues.')}
              </Alert>
            )}
            {!running && (
              <SimpleGrid cols={{ base: 2, md: 4 }}>
                {[
                  ['Pages checked', scan.visitedCount],
                  [
                    'Skipped URLs',
                    report?.coverage.skipped.length ?? scan.skippedCount,
                  ],
                  ['Navigation failures', scan.failedCount],
                  [
                    'Findings',
                    report
                      ? findings.length
                      : running
                        ? 'Pending'
                        : 'Unavailable',
                  ],
                ].map(([label, value]) => (
                  <Card key={String(label)} withBorder>
                    <Text size="xs" c="dimmed">
                      {label}
                    </Text>
                    <Text size="xl" fw={600}>
                      {value}
                    </Text>
                  </Card>
                ))}
              </SimpleGrid>
            )}
            {reportError && (
              <Alert color="orange" title="Report unavailable">
                {reportError}. Event history and page records are still
                available.
              </Alert>
            )}
            <Tabs value={activeTab} onChange={changeTab} keepMounted={false}>
              <Tabs.List
                className="screen-only scan-sections"
                aria-label="Scan sections"
              >
                <Tabs.Tab value="overview" disabled={running}>
                  Overview
                </Tabs.Tab>
                <Tabs.Tab value="issues" disabled={running}>
                  Issues{report ? ` (${findings.length})` : ''}
                </Tabs.Tab>
                <Tabs.Tab value="pages" disabled={running}>
                  Pages
                </Tabs.Tab>
                <Tabs.Tab value="skipped" disabled={running}>
                  Skipped URLs
                </Tabs.Tab>
                <Tabs.Tab value="events">Events</Tabs.Tab>
                <Tabs.Tab value="checks" disabled={running}>
                  Checks
                </Tabs.Tab>
                <Tabs.Tab value="limitations" disabled={running}>
                  Limitations
                </Tabs.Tab>
              </Tabs.List>
              <Card withBorder mt="md" p={running ? 0 : 'md'}>
                <Tabs.Panel value="overview">
                  {report ? (
                    <ScanOverview
                      key={scan.id}
                      scan={scan}
                      project={project}
                      findings={findings}
                      coverage={report.coverage}
                      summary={report.summary ?? {}}
                      onProjectUpdate={setProject}
                      onReview={(rule) => {
                        changeTab('issues');
                        if (rule) setQuery(rule);
                      }}
                      onLimitations={() => changeTab('limitations')}
                    >
                      <details>
                        <summary>Scan details</summary>
                        <Stack mt="sm" gap="xs">
                          <Title order={3} size="sm">
                            Scan stages
                          </Title>
                          <Text size="sm" c="dimmed">
                            Recorded activity by phase
                          </Text>
                          <Group>
                            {Array.from(
                              new Set(events.map((e) => e.phase)),
                            ).map((phase) => (
                              <Badge key={phase} color="gray" variant="light">
                                {phase}
                              </Badge>
                            ))}
                          </Group>
                          <Text size="sm">
                            Started:{' '}
                            {scan.startedAt
                              ? new Date(scan.startedAt).toLocaleString()
                              : 'Not started'}
                          </Text>
                          <Text size="sm">
                            Finished:{' '}
                            {scan.finishedAt
                              ? new Date(scan.finishedAt).toLocaleString()
                              : 'Pending'}
                          </Text>
                          <Text size="sm">
                            Approved origins:{' '}
                            {project?.approvedOrigins.join(', ')}
                          </Text>
                          {classification && (
                            <Text size="sm">
                              Site classification:{' '}
                              {String(classification.payload.category)}
                              {typeof classification.payload.confidence ===
                              'number'
                                ? ` · Classification confidence: ${Math.round(classification.payload.confidence * 100)}%`
                                : ''}
                            </Text>
                          )}
                        </Stack>
                      </details>
                    </ScanOverview>
                  ) : (
                    <Text size="sm">
                      {running
                        ? 'Scan in progress. Follow page visits and checks in Events.'
                        : 'No saved report is available for this run.'}
                    </Text>
                  )}
                </Tabs.Panel>
                <Tabs.Panel value="checks">
                  <Stack>
                    {report ? (
                      <>
                        {' '}
                        <Title order={3} size="sm">
                          Checks
                        </Title>
                        <Text size="sm" c="dimmed">
                          Counts show findings in this snapshot. Zero findings
                          is not a compliance certification.
                        </Text>
                        <CheckTable
                          findings={findings}
                          onReview={(rule) => {
                            changeTab('issues');
                            setQuery(rule);
                          }}
                        />
                      </>
                    ) : (
                      <Text size="sm">
                        Check results are available when a report snapshot has
                        been saved.
                      </Text>
                    )}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="limitations">
                  <Stack>
                    <Title order={2}>Coverage limitations</Title>
                    <Text size="sm" c="dimmed">
                      Recorded inspection failures and other coverage limits.
                    </Text>
                    {(report?.coverage.limitations ?? [])
                      .slice((page - 1) * pageSize, page * pageSize)
                      .map((l, i) => (
                        <Text key={i} size="sm" className="break-all">
                          {l}
                        </Text>
                      ))}
                    {pager(report?.coverage.limitations.length ?? 0)}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="issues">
                  <Stack>
                    <Group justify="space-between">
                      <Title order={2}>Issues</Title>
                      <Text size="xs" c="dimmed">
                        Saved snapshot · Current board edits do not change this
                        report
                      </Text>
                    </Group>
                    <Group className="screen-only">
                      <TextInput
                        aria-label="Search findings"
                        placeholder="Search title, URL, or rule"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(1);
                        }}
                        style={{ flex: 1 }}
                      />
                      <Select
                        aria-label="Discipline"
                        data={disciplines}
                        value={discipline}
                        onChange={(v) => {
                          setDiscipline(v);
                          setPage(1);
                        }}
                      />
                    </Group>
                    {filtered.length === 0 ? (
                      <Text size="sm">
                        {report
                          ? findings.length
                            ? 'No findings match these filters.'
                            : scan.status === 'completed'
                              ? 'No issues found on the checked pages.'
                              : 'No findings recorded. Coverage is incomplete.'
                          : 'Findings are not available yet.'}
                      </Text>
                    ) : (
                      <Table.ScrollContainer minWidth={640}>
                        <Table highlightOnHover>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Issue</Table.Th>
                              <Table.Th>Priority / status</Table.Th>
                              <Table.Th>Evidence</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {filtered
                              .slice((page - 1) * pageSize, page * pageSize)
                              .map((item, index) => (
                                <Table.Tr key={`${item.issueId}-${index}`}>
                                  <Table.Td>
                                    <Anchor
                                      component="button"
                                      onClick={() => setSelected(item)}
                                      ta="left"
                                    >
                                      {item.title}
                                    </Anchor>
                                    <Text
                                      size="xs"
                                      c="dimmed"
                                      className="break-all"
                                    >
                                      {item.affectedUrl}
                                    </Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Badge
                                      color={
                                        ['P0', 'P1'].includes(item.priority)
                                          ? 'orange'
                                          : 'gray'
                                      }
                                    >
                                      {item.priority}
                                    </Badge>
                                    <Text size="xs">
                                      {item.status.replaceAll('_', ' ')}
                                    </Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Stack gap={4}>
                                      {citations(item).map((c) => (
                                        <Anchor
                                          key={c.evidenceId}
                                          size="xs"
                                          component={Link}
                                          href={proofLink(c.evidenceId)}
                                        >
                                          {c.label}
                                        </Anchor>
                                      ))}
                                    </Stack>
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                          </Table.Tbody>
                        </Table>
                      </Table.ScrollContainer>
                    )}
                    {pager(filtered.length)}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="pages">
                  <Stack>
                    <Title order={2}>Pages</Title>
                    <Text size="sm" c="dimmed">
                      Recorded page results. Page budget is a crawl limit, not
                      the total size of the website.
                    </Text>
                    <Table.ScrollContainer minWidth={600}>
                      <Table>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>URL</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Timing</Table.Th>
                            <Table.Th>Screenshot</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {pages.map((p) => (
                            <Table.Tr key={p.id}>
                              <Table.Td>
                                <Text size="sm" className="break-all">
                                  {p.normalizedUrl}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {p.title}
                                </Text>
                              </Table.Td>
                              <Table.Td>{p.httpStatus ?? 'Failed'}</Table.Td>
                              <Table.Td>
                                {p.timingMs === null ? '—' : `${p.timingMs} ms`}
                              </Table.Td>
                              <Table.Td>
                                {p.screenshots?.map((s) => (
                                  <Anchor
                                    display="block"
                                    key={s.id}
                                    component={Link}
                                    href={proofLink(s.id)}
                                    size="xs"
                                  >
                                    {s.viewport}
                                  </Anchor>
                                ))}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                    <Group justify="space-between">
                      <Text size="xs">
                        {pages.length ? pagesOffset + 1 : 0}–
                        {pagesOffset + pages.length} shown
                      </Text>
                      <Group>
                        <Button
                          size="xs"
                          variant="default"
                          disabled={pagesOffset === 0}
                          onClick={() =>
                            setPagesOffset(Math.max(0, pagesOffset - pageSize))
                          }
                        >
                          Previous
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          disabled={pagesNext === null}
                          onClick={() => setPagesOffset(pagesNext!)}
                        >
                          Next
                        </Button>
                      </Group>
                    </Group>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="skipped">
                  <Stack>
                    <Title order={2}>Skipped URLs</Title>
                    <Text size="sm" c="dimmed">
                      Excluded resources are coverage limitations, not defects.
                    </Text>
                    <TextInput
                      className="screen-only"
                      aria-label="Search skipped URLs"
                      placeholder="Search URL or reason"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                    />
                    {skipped
                      .slice((page - 1) * pageSize, page * pageSize)
                      .map((s, i) => (
                        <div key={i}>
                          <Text size="sm" className="break-all">
                            {s.url}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {s.reason}
                          </Text>
                        </div>
                      ))}
                    {!skipped.length && (
                      <Text size="sm">
                        {report
                          ? 'No skipped URLs match.'
                          : 'Final coverage is not available yet. See Events for recorded skips.'}
                      </Text>
                    )}
                    {pager(skipped.length)}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="events">
                  <Stack p={running ? 'md' : 0}>
                    <Group justify="space-between">
                      <Title order={2} size="md">
                        Developer terminal
                      </Title>
                      <Text size="xs" c="dimmed" role="status">
                        {connection}
                      </Text>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              filteredEvents
                                .map(
                                  (e) =>
                                    `${String(e.seq).padStart(4, '0')} ${e.at} [${e.level}] [${e.phase}] ${e.message}`,
                                )
                                .join('\n'),
                            );
                          } catch {
                            setError('Could not copy logs');
                          }
                        }}
                      >
                        Copy output
                      </Button>
                    </Group>
                    <Group className="screen-only">
                      <TextInput
                        aria-label="Search events"
                        placeholder="Search message or phase"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(1);
                        }}
                        style={{ flex: 1 }}
                      />
                      <Select
                        aria-label="Event level"
                        value={level}
                        onChange={(v) => {
                          setLevel(v);
                          setPage(1);
                        }}
                        data={['all', 'debug', 'info', 'warn', 'error'].map(
                          (v) => ({
                            value: v,
                            label: v === 'all' ? 'All levels' : v,
                          }),
                        )}
                      />
                      <Switch
                        label="Follow latest"
                        checked={follow}
                        onChange={(e) => {
                          setFollow(e.currentTarget.checked);
                        }}
                      />
                    </Group>
                    <div
                      className="scan-event-log"
                      ref={terminalRef}
                      role="log"
                      aria-label="Developer terminal log"
                      aria-live="polite"
                      tabIndex={0}
                    >
                      {filteredEvents.map((e) => (
                        <div className="terminal-line" key={e.seq}>
                          <span className="terminal-seq">
                            {String(e.seq).padStart(4, '0')}
                          </span>
                          <time>{new Date(e.at).toLocaleTimeString()}</time>
                          <strong className={`event-${e.level}`}>
                            [{e.level.toUpperCase()}]
                          </strong>
                          <span className="terminal-phase">{e.phase}</span>
                          <span className="terminal-message">{e.message}</span>
                        </div>
                      ))}
                      {!filteredEvents.length && (
                        <Text size="sm" c="gray.4">
                          {events.length
                            ? 'No matching events.'
                            : 'Waiting for scan events…'}
                        </Text>
                      )}
                    </div>
                    <Text size="xs" c="dimmed">
                      {filteredEvents.length} of {events.length} stored events ·
                      Ordered by sequence
                    </Text>
                  </Stack>
                </Tabs.Panel>
              </Card>
            </Tabs>
          </>
        )}
        <Drawer
          opened={!!selected}
          onClose={() => setSelected(null)}
          position="right"
          size="lg"
          title="Issue at scan completion"
        >
          <Stack>
            {selected && (
              <>
                <Title order={2}>{selected.title}</Title>
                <Text size="sm" className="break-all">
                  {selected.affectedUrl}
                </Text>
                <Group>
                  <Badge>{selected.priority}</Badge>
                  <Badge color="gray">{selected.status}</Badge>
                  <Text size="xs">
                    Confidence: {Math.round(selected.confidence * 100)}%
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {selected.ruleId} · Check version {selected.ruleVersion} ·{' '}
                  {report?.createdAt
                    ? new Date(report.createdAt).toLocaleString()
                    : ''}
                </Text>
                {[
                  [
                    'Observation',
                    fact(selected, 'observed') || selected.description,
                  ],
                  ['Impact', fact(selected, 'impact')],
                  [
                    'Suggested fix',
                    fact(selected, 'suggestedFix', 'suggested_fix'),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <Title order={3} size="sm">
                      {label}
                    </Title>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {value || 'Not recorded'}
                    </Text>
                  </div>
                ))}
                <Title order={3} size="sm">
                  Reproduction
                </Title>
                {steps(selected).length ? (
                  <ol>
                    {steps(selected).map((s, i) => (
                      <li key={i}>
                        <Text size="sm">{s}</Text>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Text size="sm">Not recorded</Text>
                )}
                <Title order={3} size="sm">
                  Evidence
                </Title>
                {citations(selected).map((c) => (
                  <Anchor
                    component={Link}
                    key={c.evidenceId}
                    href={proofLink(c.evidenceId)}
                  >
                    {c.label} · Open proof details
                  </Anchor>
                ))}
                <Text size="xs" c="dimmed">
                  The proof viewer shows capture time, type, and retention
                  availability.
                </Text>
                <Button
                  component={Link}
                  href={`/projects/${id}/issues/${selected.issueId}`}
                  variant="default"
                >
                  Edit current issue
                </Button>
              </>
            )}
          </Stack>
        </Drawer>
        <Modal
          opened={exportOpen}
          onClose={() => setExportOpen(false)}
          title="Export report"
          centered
        >
          <Stack>
            <Select
              label="Discipline"
              data={disciplines}
              value={exportDiscipline}
              onChange={setExportDiscipline}
            />
            <Select
              label="Format"
              value={format}
              onChange={setFormat}
              data={[
                { value: 'markdown', label: 'Markdown (.md)' },
                { value: 'pdf', label: 'Print / Save as PDF' },
              ]}
            />
            <Text size="sm" c="dimmed">
              {exportItems.length} findings from this saved snapshot.
              {format === 'pdf'
                ? ' The print view includes all selected findings.'
                : ''}
            </Text>
            <Button onClick={exportReport}>Export</Button>
            <Anchor
              size="sm"
              component={Link}
              href={`/projects/${id}/integrations`}
            >
              Manage integrations
            </Anchor>
          </Stack>
        </Modal>
        <section className="print-report">
          <h2>Issue snapshot</h2>
          {exportItems.map((i, index) => (
            <article key={`${i.issueId}-${index}`}>
              <h3>
                {i.priority} · {i.title}
              </h3>
              <p>
                {i.affectedUrl} · {i.ruleId} · {i.status}
              </p>
              <p>{fact(i, 'observed') || i.description}</p>
              <p>Impact: {fact(i, 'impact') || 'Not recorded'}</p>
              <p>
                Suggested fix:{' '}
                {fact(i, 'suggestedFix', 'suggested_fix') || 'Not recorded'}
              </p>
              <ol>
                {steps(i).map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ol>
              {citations(i).map((c) => (
                <p key={c.evidenceId}>
                  <a href={proofLink(c.evidenceId)}>{c.label}</a>
                </p>
              ))}
            </article>
          ))}
        </section>
      </Stack>
    </Container>
  );
}
