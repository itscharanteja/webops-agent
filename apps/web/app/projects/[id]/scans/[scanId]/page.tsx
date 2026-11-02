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
  Group,
  Progress,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type {
  Project,
  ReportIssueSnapshotItem,
  Scan,
  ScanEvent,
  ScanPage,
} from '@webops/contracts';
import { apiFetch, apiStream } from '../../../../../lib/client';

type Coverage = {
  visitedUrls: string[];
  skipped: Array<{ url: string; reason: string }>;
  failedCount: number;
  limitations: string[];
};
type Report = {
  coverage: Coverage;
  issueSnapshot?: ReportIssueSnapshotItem[];
  createdAt?: string;
};
const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);

export default function LiveScanPage() {
  const { id, scanId } = useParams<{ id: string; scanId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting to live log…');
  const [cancelling, setCancelling] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const current: Scan = await apiFetch(`/v1/scans/${scanId}`);
        if (stopped) return;
        setScan(current);
        if (terminal.has(current.status)) {
          const [pageData, reportData] = await Promise.all([
            apiFetch(`/v1/scans/${scanId}/pages?limit=100`),
            apiFetch(`/v1/scans/${scanId}/report`).catch(() => null),
          ]);
          if (!stopped) {
            setPages(pageData.items);
            setReport(reportData);
          }
        }
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error ? cause.message : 'Could not load scan',
          );
      }
    };
    void apiFetch(`/v1/projects/${id}`)
      .then((data) => {
        if (!stopped) setProject(data);
      })
      .catch(() => undefined);
    void refresh();
    const poll = setInterval(() => {
      if (!stopped) void refresh();
    }, 2_000);

    const receive = (block: string) => {
      const data = block.split('\n').find((line) => line.startsWith('data: '));
      if (!data) return false;
      try {
        const event = JSON.parse(data.slice(6)) as ScanEvent;
        if (event.seq <= lastSeq.current) return false;
        lastSeq.current = event.seq;
        setEvents((previous) => [...previous, event]);
        if (event.payload.terminal === true) {
          void refresh();
          return true;
        }
      } catch {
        setConnection('Reconnecting to live log…');
      }
      return false;
    };
    const watch = async () => {
      while (!stopped) {
        try {
          const response = await apiStream(
            `/v1/scans/${scanId}/events`,
            lastSeq.current,
            controller.signal,
          );
          if (!response.ok || !response.body)
            throw new Error(`Live log returned ${response.status}`);
          setConnection('Live');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let completed = false;
          while (!stopped) {
            const part = await reader.read();
            if (part.done) break;
            buffer += decoder
              .decode(part.value, { stream: true })
              .replace(/\r/g, '');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (receive(block)) completed = true;
            }
            if (completed) {
              setConnection('Finished');
              return;
            }
          }
        } catch {
          if (!stopped) setConnection('Reconnecting to live log…');
        }
        if (!stopped)
          await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    };
    void watch();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(poll);
    };
  }, [id, scanId]);

  async function cancel() {
    setCancelling(true);
    setError('');
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
  const visited = new Set(
    events
      .filter(
        (event) =>
          event.phase === 'crawl' && event.message.startsWith('Visited '),
      )
      .map((event) => String(event.payload.url ?? '')),
  ).size;
  const pageBudget = project?.crawlLimits.maxPages ?? 25;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Anchor component={Link} href={`/projects/${id}`}>
          ← {project?.name ?? 'Project'}
        </Anchor>
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={1}>Scan</Title>
            <Text size="sm" c="dimmed">
              {scanId}
            </Text>
          </div>
          <Group>
            <Badge
              size="lg"
              color={
                scan?.status === 'completed'
                  ? 'green'
                  : scan?.status === 'running'
                    ? 'blue'
                    : 'orange'
              }
            >
              {scan?.status ?? 'Loading'}
            </Badge>
            <Button
              color="red"
              variant="light"
              onClick={cancel}
              loading={cancelling}
              disabled={
                !scan || terminal.has(scan.status) || !!scan.cancelRequestedAt
              }
            >
              Cancel scan
            </Button>
          </Group>
          <Anchor component={Link} href={`/projects/${id}/issues`}>
            Open issues board
          </Anchor>
        </Group>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {scan && scan.status !== 'completed' && terminal.has(scan.status) && (
          <Alert color="orange" title="Incomplete coverage">
            This scan ended {scan.status}. Review the coverage and limitations
            below.
          </Alert>
        )}
        <Card withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={700}>Crawl progress</Text>
              <Text size="sm">
                {scan?.visitedCount || visited} pages recorded · budget{' '}
                {pageBudget}
              </Text>
            </Group>
            <Progress
              value={Math.min(
                100,
                ((scan?.visitedCount || visited) / pageBudget) * 100,
              )}
              aria-label="Page budget used"
            />
            <Text size="sm" c="dimmed">
              {scan?.cancelRequestedAt ? 'Cancellation requested' : connection}
            </Text>
          </Stack>
        </Card>
        <Card withBorder>
          <Stack>
            <Title order={2}>Live log</Title>
            <div
              role="log"
              aria-label="Scan events"
              aria-live="polite"
              className="max-h-96 overflow-y-auto rounded-md bg-slate-950 p-4 font-mono text-sm text-slate-100"
            >
              {events.length === 0 && <div>Waiting for scan events…</div>}
              {events.map((event) => (
                <div key={event.seq} className="py-0.5">
                  <span className="text-slate-400">
                    {String(event.seq).padStart(4, '0')}{' '}
                    {new Date(event.at).toLocaleTimeString()}
                  </span>{' '}
                  <span
                    className={
                      event.level === 'error'
                        ? 'text-red-300'
                        : event.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                    }
                  >
                    [{event.level}]
                  </span>{' '}
                  <span className="text-sky-300">{event.phase}</span>{' '}
                  {event.message}
                </div>
              ))}
            </div>
          </Stack>
        </Card>
        {report && (
          <Card withBorder>
            <Stack>
              <Title order={2}>Coverage</Title>
              <Text>
                {report.coverage.visitedUrls.length} visited ·{' '}
                {report.coverage.skipped.length} skipped ·{' '}
                {report.coverage.failedCount} failed pages
              </Text>
              {report.coverage.limitations.map((item, index) => (
                <Alert key={index} color="orange">
                  {item}
                </Alert>
              ))}
              {report.coverage.skipped.length > 0 && (
                <>
                  <Text fw={700}>Skipped URLs</Text>
                  {report.coverage.skipped.map((item, index) => (
                    <Text size="sm" key={`${item.url}-${index}`}>
                      {item.url} — {item.reason}
                    </Text>
                  ))}
                </>
              )}
            </Stack>
          </Card>
        )}
        {report && (
          <Card withBorder>
            <Stack>
              <Group justify="space-between">
                <Title order={2}>Report Snapshot</Title>
                <Badge color="gray">
                  {report.issueSnapshot?.length ?? 0} findings captured
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Immutable record frozen at scan completion. Issues and evidence
                remain as captured, even if current issues board entries are
                subsequently modified.
              </Text>
              {!report.issueSnapshot || report.issueSnapshot.length === 0 ? (
                <Text c="dimmed">No findings recorded in this report.</Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Captured issue</Table.Th>
                      <Table.Th>Rule</Table.Th>
                      <Table.Th>Priority</Table.Th>
                      <Table.Th>Proof citations</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {report.issueSnapshot.map((item, index) => (
                      <Table.Tr key={`${item.issueId}-${index}`}>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text fw={600}>{item.title}</Text>
                            <Text size="xs" c="dimmed" className="break-all">
                              {item.affectedUrl}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="outline">
                            {item.ruleId}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            size="xs"
                            color={
                              item.priority === 'P0'
                                ? 'red'
                                : item.priority === 'P1'
                                  ? 'orange'
                                  : item.priority === 'P2'
                                    ? 'yellow'
                                    : 'gray'
                            }
                          >
                            {item.priority}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            {item.citations.map((c) => (
                              <Anchor
                                key={c.evidenceId}
                                component={Link}
                                href={`/projects/${id}/scans/${scanId}/evidence/${c.evidenceId}`}
                              >
                                {c.label || c.kind}
                              </Anchor>
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </Card>
        )}
        {pages.length > 0 && (
          <Card withBorder>
            <Stack>
              <Title order={2}>Pages</Title>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>URL</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Screenshots</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pages.map((page) => (
                    <Table.Tr key={page.id}>
                      <Table.Td className="break-all">
                        {page.normalizedUrl}
                      </Table.Td>
                      <Table.Td>{page.httpStatus ?? 'Failed'}</Table.Td>
                      <Table.Td>{page.title || '—'}</Table.Td>
                      <Table.Td>{page.timingMs ?? '—'} ms</Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          {page.screenshots.map((shot) => (
                            <Anchor
                              key={shot.id}
                              component={Link}
                              href={`/projects/${id}/scans/${scanId}/evidence/${shot.id}`}
                            >
                              {shot.viewport}
                            </Anchor>
                          ))}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          </Card>
        )}
      </Stack>
    </Container>
  );
}
