'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { Project, Scan, ScanEvent, ScanPage } from '@webops/contracts';
import { apiFetch, apiStream } from '../../../../../../lib/client';

const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start) return '0s';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const diffSec = Math.max(0, Math.round((endTime - startTime) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const remSec = diffSec % 60;
  return `${mins}m ${remSec}s`;
}

export default function ScanningProgressPage() {
  const { id, scanId } = useParams<{ id: string; scanId: string }>();
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting to agent stream…');
  const [cancelling, setCancelling] = useState(false);

  // Terminal state
  const [autoscroll, setAutoscroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [urlSearchQuery, setUrlSearchQuery] = useState('');
  const [eventFilter, setEventFilter] = useState<
    'all' | 'agent' | 'crawl' | 'finding' | 'warn'
  >('all');
  const [copied, setCopied] = useState(false);
  const [stayOnLive, setStayOnLive] = useState(false);
  const [autoRedirectTimer, setAutoRedirectTimer] = useState<number | null>(
    null,
  );

  const lastSeq = useRef(0);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // SSE and data polling
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();

    const refresh = async () => {
      try {
        const current: Scan = await apiFetch(`/v1/scans/${scanId}`);
        if (stopped) return;
        setScan(current);
        if (terminal.has(current.status)) {
          const pageData = await apiFetch(
            `/v1/scans/${scanId}/pages?limit=100`,
          ).catch(() => ({ items: [] }));
          if (!stopped) {
            setPages(pageData.items);
          }
        }
      } catch (cause) {
        if (!stopped) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load scan status',
          );
        }
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
        setEvents((prev) => [...prev, event]);
        if (event.payload.terminal === true) {
          void refresh();
          return true;
        }
      } catch {
        setConnection('Reconnecting…');
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
          if (!response.ok || !response.body) {
            throw new Error(`Live log returned ${response.status}`);
          }
          setConnection('Connected (Streaming Telemetry)');
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
              setConnection('Audit Concluded');
              return;
            }
          }
        } catch {
          if (!stopped) setConnection('Reconnecting…');
        }
        if (!stopped) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    };

    void watch();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(poll);
    };
  }, [id, scanId]);

  // Terminal auto-scroll
  useEffect(() => {
    if (autoscroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [events, autoscroll]);

  const isScanning = scan ? !terminal.has(scan.status) : true;
  const isTerminal = scan ? terminal.has(scan.status) : false;

  // Auto-redirect countdown when scan completes (unless user opts to stay)
  useEffect(() => {
    if (isTerminal && !stayOnLive && autoRedirectTimer === null) {
      setAutoRedirectTimer(8);
    }
  }, [isTerminal, stayOnLive, autoRedirectTimer]);

  useEffect(() => {
    if (autoRedirectTimer === null || stayOnLive) return;
    if (autoRedirectTimer <= 0) {
      router.push(`/projects/${id}/scans/${scanId}`);
      return;
    }
    const timer = setTimeout(() => {
      setAutoRedirectTimer((prev) => (prev !== null ? prev - 1 : null));
    }, 1_000);
    return () => clearTimeout(timer);
  }, [autoRedirectTimer, stayOnLive, id, scanId, router]);

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

  function handleCopyLogs() {
    const text = events
      .map(
        (e) =>
          `${String(e.seq).padStart(4, '0')} ${new Date(e.at).toLocaleTimeString()} [${e.level.toUpperCase()}] [${e.phase}] ${e.message}`,
      )
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // 1. Discovered Sites/URLs from the target URL
  const discoveredUrls = useMemo(() => {
    const map = new Map<
      string,
      {
        url: string;
        source: string;
        status: 'queued' | 'crawling' | 'visited' | 'skipped';
        title?: string | undefined;
        httpStatus?: number | undefined;
      }
    >();

    if (project?.baseUrl) {
      map.set(project.baseUrl, {
        url: project.baseUrl,
        source: 'Seed Base Target',
        status: 'queued',
      });
    }

    for (const e of events) {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      if (
        e.message.startsWith('Discovered ') ||
        payload.destination ||
        payload.source
      ) {
        const u = String(payload.url || payload.destination || '');
        if (u) {
          const existing = map.get(u);
          map.set(u, {
            url: u,
            source: String(payload.source || 'Anchor Link on Page'),
            status: existing?.status || 'queued',
          });
        }
      }
      if (
        e.message.startsWith('Crawling ') ||
        (e.phase === 'crawl' && payload.status === 'crawling')
      ) {
        const u = String(payload.url || '');
        if (u) {
          const existing = map.get(u);
          map.set(u, {
            url: u,
            source: existing?.source || 'Active Crawler',
            status: 'crawling',
          });
        }
      }
      if (
        e.message.startsWith('Visited ') ||
        (e.phase === 'crawl' && typeof payload.status === 'number')
      ) {
        const u = String(payload.url || '');
        if (u) {
          const existing = map.get(u);
          map.set(u, {
            url: u,
            source: existing?.source || 'Internal Crawl',
            status: 'visited',
            httpStatus: Number(payload.status),
          });
        }
      }
      if (e.message.startsWith('Skipped ')) {
        const u = String(payload.url || '');
        if (u) {
          const existing = map.get(u);
          map.set(u, {
            url: u,
            source: existing?.source || 'External / Out of Policy',
            status: 'skipped',
          });
        }
      }
    }

    for (const p of pages) {
      if (p.normalizedUrl) {
        const existing = map.get(p.normalizedUrl);
        map.set(p.normalizedUrl, {
          url: p.normalizedUrl,
          source: existing?.source || 'Internal Crawl',
          status: 'visited',
          httpStatus: p.httpStatus ?? undefined,
          title: p.title ?? undefined,
        });
      }
    }

    return Array.from(map.values());
  }, [events, pages, project?.baseUrl]);

  const filteredDiscoveredUrls = useMemo(() => {
    if (!urlSearchQuery.trim()) return discoveredUrls;
    const q = urlSearchQuery.toLowerCase();
    return discoveredUrls.filter(
      (item) =>
        item.url.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q),
    );
  }, [discoveredUrls, urlSearchQuery]);

  // 2. Active in-flight crawl target
  const currentCrawl = useMemo(() => {
    if (!isScanning) return null;

    const crawlingEvent = [...events]
      .reverse()
      .find(
        (e) =>
          e.phase === 'crawl' &&
          (e.message.startsWith('Crawling ') ||
            e.message.startsWith('Visiting ')),
      );

    const latestAgentEvent = [...events]
      .reverse()
      .find((e) => e.phase.startsWith('agent'));

    const latestEvent = events[events.length - 1];

    let activeUrl = '';
    if (crawlingEvent) {
      const p = crawlingEvent.payload as Record<string, unknown> | undefined;
      activeUrl = String(p?.url || '');
      if (!activeUrl) {
        const match = crawlingEvent.message.match(
          /^(?:Crawling|Visiting)\s+(\S+)/,
        );
        if (match && match[1]) activeUrl = match[1];
      }
    }

    if (!activeUrl) {
      activeUrl = project?.baseUrl || 'Initializing target navigation...';
    }

    const action = latestAgentEvent
      ? latestAgentEvent.message
      : latestEvent
        ? latestEvent.message
        : 'Playwright headless browser session engaged...';

    return {
      url: activeUrl,
      action,
      phase: latestEvent?.phase || 'crawl',
    };
  }, [events, isScanning, project?.baseUrl]);

  // 3. Count visited pages and progress
  const visitedCount =
    scan?.visitedCount ||
    discoveredUrls.filter((item) => item.status === 'visited').length;

  const pageBudget = project?.crawlLimits.maxPages ?? 25;
  const progressPercent = Math.min(
    100,
    Math.round((visitedCount / pageBudget) * 100),
  );

  // 4. Discovered findings in live stream
  const liveFindings = useMemo(() => {
    const findingEvents = events.filter(
      (e) =>
        e.phase === 'finding' ||
        e.message.startsWith('[Finding]') ||
        e.message.includes('Finding:') ||
        e.message.toLowerCase().includes('observed'),
    );
    return findingEvents.map((e) => {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      return {
        seq: e.seq,
        at: e.at,
        message: e.message,
        ruleId: String(payload.rule_id || 'DEFECT'),
        priority: String(payload.priority || 'P2'),
        url: String(payload.url || payload.page_url || ''),
        title: String(payload.title || e.message),
      };
    });
  }, [events]);

  // Terminal filtered events
  const filteredEvents = useMemo(() => {
    let result = events;
    if (eventFilter === 'agent') {
      result = result.filter(
        (e) =>
          e.phase.startsWith('agent') ||
          e.phase === 'taxonomy' ||
          e.message.startsWith('[Agent') ||
          e.message.startsWith('[Visual') ||
          e.message.startsWith('[Interaction') ||
          e.message.startsWith('[Navigation'),
      );
    } else if (eventFilter === 'crawl') {
      result = result.filter((e) => e.phase === 'crawl');
    } else if (eventFilter === 'warn') {
      result = result.filter((e) => e.level === 'warn' || e.level === 'error');
    } else if (eventFilter === 'finding') {
      result = result.filter(
        (e) =>
          e.phase === 'finding' ||
          e.message.toLowerCase().includes('finding') ||
          e.message.toLowerCase().includes('observed'),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.phase.toLowerCase().includes(q) ||
          e.level.toLowerCase().includes(q),
      );
    }
    return result;
  }, [events, eventFilter, searchQuery]);

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        {/* Navigation Breadcrumbs */}
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Anchor component={Link} href="/projects">
              Projects
            </Anchor>
            <Text c="dimmed">/</Text>
            <Anchor component={Link} href={`/projects/${id}`}>
              {project?.name || 'Project'}
            </Anchor>
            <Text c="dimmed">/</Text>
            <Text fw={600}>Live Scan Progress</Text>
          </Group>

          <Group gap="xs">
            {isTerminal && (
              <Button
                component={Link}
                href={`/projects/${id}/scans/${scanId}`}
                color="teal"
                variant="filled"
                size="sm"
              >
                👉 Go to Final Audit Report & Deliverables →
              </Button>
            )}
            {isScanning && (
              <Button
                color="red"
                variant="light"
                size="xs"
                onClick={cancel}
                loading={cancelling}
                disabled={!!scan?.cancelRequestedAt}
              >
                {scan?.cancelRequestedAt
                  ? 'Cancellation Requested…'
                  : 'Cancel Audit'}
              </Button>
            )}
          </Group>
        </Group>

        {error && (
          <Alert
            color="red"
            role="alert"
            withCloseButton
            onClose={() => setError('')}
          >
            {error}
          </Alert>
        )}

        {/* POST-COMPLETION CELEBRATION & REDIRECT BANNER */}
        {isTerminal && (
          <Paper
            withBorder
            p="lg"
            radius="md"
            bg="teal.0"
            style={{
              borderColor: 'var(--mantine-color-teal-5)',
              boxShadow: '0 4px 12px rgba(20, 184, 166, 0.15)',
            }}
          >
            <Group justify="space-between" align="center" wrap="wrap">
              <Group gap="md">
                <Text size="2.2rem">🎉</Text>
                <div>
                  <Title order={3} c="teal.9">
                    {scan?.status === 'completed'
                      ? 'Autonomous Web Audit Completed!'
                      : `Scan Finished (${scan?.status?.toUpperCase()})`}
                  </Title>
                  <Text size="sm" c="teal.9" mt={2}>
                    Successfully crawled <b>{visitedCount}</b> page(s),
                    discovered <b>{discoveredUrls.length}</b> site URL(s), and
                    verified <b>{liveFindings.length}</b> finding(s).
                  </Text>
                  {autoRedirectTimer !== null && !stayOnLive && (
                    <Text size="xs" c="teal.8" mt={4} fw={500}>
                      ⏱️ Auto-redirecting to the final report in{' '}
                      <b>{autoRedirectTimer}s</b>…
                    </Text>
                  )}
                </div>
              </Group>

              <Group gap="sm">
                {autoRedirectTimer !== null && !stayOnLive && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      setStayOnLive(true);
                      setAutoRedirectTimer(null);
                    }}
                  >
                    Stay on Live Console
                  </Button>
                )}
                <Button
                  component={Link}
                  href={`/projects/${id}/scans/${scanId}`}
                  color="teal"
                  size="md"
                  style={{ fontWeight: 700 }}
                >
                  View Final Audit Report & Deliverables →
                </Button>
              </Group>
            </Group>
          </Paper>
        )}

        {/* LIVE MISSION CONTROL BANNER */}
        <Paper
          withBorder
          p="md"
          radius="md"
          bg={isScanning ? 'blue.0' : 'gray.0'}
          style={{
            borderColor: isScanning
              ? 'var(--mantine-color-blue-4)'
              : 'var(--mantine-color-gray-3)',
          }}
        >
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm" align="center">
              {isScanning ? (
                <Group gap="xs">
                  <Loader size="sm" color="blue" />
                  <Badge size="md" color="blue" variant="filled">
                    SCANNING IN PROGRESS
                  </Badge>
                </Group>
              ) : (
                <Badge
                  size="md"
                  color={scan?.status === 'completed' ? 'teal' : 'gray'}
                  variant="filled"
                >
                  AUDIT {scan?.status?.toUpperCase() ?? 'COMPLETED'}
                </Badge>
              )}
              <Text size="sm" fw={700}>
                Target: {project?.baseUrl}
              </Text>
            </Group>

            <Group gap="xs">
              <Badge size="sm" variant="light" color="indigo">
                Viewports: 1440×900 & 375×812
              </Badge>
              <Badge size="sm" variant="outline" color="gray">
                Elapsed:{' '}
                {formatDuration(
                  scan?.startedAt ?? scan?.queuedAt,
                  scan?.finishedAt,
                )}
              </Badge>
              <Badge
                size="sm"
                variant="dot"
                color={
                  connection.includes('Streaming')
                    ? 'green'
                    : connection.includes('Concluded')
                      ? 'teal'
                      : 'orange'
                }
              >
                {connection}
              </Badge>
            </Group>
          </Group>
        </Paper>

        {/* 4 HIGH-VISIBILITY PROGRESS CARDS */}
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          {/* CARD 1: CURRENT ACTIVE CRAWL TARGET */}
          <Card
            withBorder
            padding="md"
            radius="md"
            style={{
              borderColor: isScanning
                ? 'var(--mantine-color-blue-5)'
                : undefined,
              boxShadow: isScanning
                ? '0 2px 8px rgba(37, 99, 235, 0.12)'
                : undefined,
            }}
          >
            <Group justify="space-between" align="center" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Currently Crawling
              </Text>
              {isScanning && (
                <Badge size="xs" color="blue" variant="light">
                  Active Page
                </Badge>
              )}
            </Group>

            {isScanning && currentCrawl ? (
              <Stack gap={4}>
                <Text
                  size="xs"
                  fw={700}
                  c="blue.9"
                  style={{
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                    backgroundColor: 'var(--mantine-color-blue-1)',
                    padding: '4px 6px',
                    borderRadius: '4px',
                  }}
                  lineClamp={2}
                >
                  {currentCrawl.url}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={2} mt={2}>
                  {currentCrawl.action}
                </Text>
              </Stack>
            ) : (
              <Stack gap={2}>
                <Text size="sm" fw={600} c="dimmed">
                  {scan?.status === 'completed'
                    ? 'All reachable pages inspected'
                    : 'Crawl idle'}
                </Text>
                <Text size="xs" c="dimmed">
                  {visitedCount} total pages analyzed
                </Text>
              </Stack>
            )}
          </Card>

          {/* CARD 2: SITES / URLS DISCOVERED */}
          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" align="center" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Sites / URLs Discovered
              </Text>
              <Badge size="xs" color="indigo" variant="light">
                Breadth-First
              </Badge>
            </Group>
            <Group justify="space-between" align="flex-end">
              <Text size="1.7rem" fw={800} c="indigo">
                {discoveredUrls.length}
              </Text>
              <Text size="xs" c="dimmed">
                from seed target
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              {discoveredUrls.filter((u) => u.status === 'visited').length}{' '}
              visited,{' '}
              {discoveredUrls.filter((u) => u.status === 'queued').length} in
              queue
            </Text>
          </Card>

          {/* CARD 3: PAGES AUDITED / TOTAL TO AUDIT (MAX PAGES) */}
          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" align="center" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Pages Audited / Total Pages to Audit (Max Pages)
              </Text>
              <Text size="sm" fw={700} c="blue">
                {progressPercent}%
              </Text>
            </Group>
            <Group justify="space-between" align="flex-end">
              <Text size="1.7rem" fw={800}>
                {visitedCount}{' '}
                <span className="text-sm font-normal text-slate-400">
                  / {pageBudget} max
                </span>
              </Text>
              <Badge size="xs" color="blue" variant="light">
                {visitedCount} of {pageBudget} pages
              </Badge>
            </Group>
            <Progress
              value={progressPercent}
              animated={isScanning}
              striped={isScanning}
              size="sm"
              mt="xs"
              color="blue"
              radius="xl"
            />
            <Text size="xs" c="dimmed" mt={4}>
              {visitedCount} audited / {pageBudget} max pages
            </Text>
          </Card>

          {/* CARD 4: ISSUES DETECTED */}
          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" align="center" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                Issues Detected
              </Text>
              <Badge
                size="xs"
                color={liveFindings.length > 0 ? 'orange' : 'teal'}
                variant="light"
              >
                {liveFindings.length > 0 ? 'Defects Found' : 'Clean'}
              </Badge>
            </Group>
            <Group justify="space-between" align="flex-end">
              <Text
                size="1.7rem"
                fw={800}
                c={liveFindings.length > 0 ? 'orange.8' : 'teal'}
              >
                {liveFindings.length}
              </Text>
              <Group gap={4}>
                {liveFindings.filter((f) => f.priority === 'P0').length > 0 && (
                  <Badge size="xs" color="red">
                    P0: {liveFindings.filter((f) => f.priority === 'P0').length}
                  </Badge>
                )}
                {liveFindings.filter((f) => f.priority === 'P1').length > 0 && (
                  <Badge size="xs" color="orange">
                    P1: {liveFindings.filter((f) => f.priority === 'P1').length}
                  </Badge>
                )}
                {liveFindings.filter((f) => f.priority === 'P2').length > 0 && (
                  <Badge size="xs" color="yellow">
                    P2: {liveFindings.filter((f) => f.priority === 'P2').length}
                  </Badge>
                )}
              </Group>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Cryptographic DOM & visual proof captured
            </Text>
          </Card>
        </SimpleGrid>

        {/* DISCOVERED URLS EXPANDED TABLE */}
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <div>
                <Group gap="xs">
                  <Text fw={700} size="sm">
                    🌐 Discovered URLs & Route Tree ({discoveredUrls.length})
                  </Text>
                  {isScanning && <Loader size="xs" color="indigo" />}
                </Group>
                <Text size="xs" c="dimmed">
                  All pages and endpoints discovered by navigating anchor links
                  from the seed URL
                </Text>
              </div>

              <TextInput
                size="xs"
                placeholder="Search discovered URLs..."
                value={urlSearchQuery}
                onChange={(e) => setUrlSearchQuery(e.currentTarget.value)}
                style={{ width: 240 }}
              />
            </Group>

            <ScrollArea h={180}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 110 }}>Status</Table.Th>
                    <Table.Th>Discovered URL</Table.Th>
                    <Table.Th style={{ width: 180 }}>Discovery Source</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredDiscoveredUrls.length === 0 ? (
                    <Table.Tr>
                      <Table.Td
                        colSpan={3}
                        className="text-center text-slate-400 py-3"
                      >
                        {isScanning
                          ? 'Waiting for crawler to extract links from seed page...'
                          : 'No URLs match your search filter.'}
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    filteredDiscoveredUrls.slice(0, 50).map((item, index) => (
                      <Table.Tr key={`${item.url}-${index}`}>
                        <Table.Td>
                          {item.status === 'crawling' ? (
                            <Badge size="xs" color="blue" variant="filled">
                              Crawling…
                            </Badge>
                          ) : item.status === 'visited' ? (
                            <Badge size="xs" color="teal" variant="light">
                              HTTP {item.httpStatus ?? 200}
                            </Badge>
                          ) : item.status === 'skipped' ? (
                            <Badge size="xs" color="gray" variant="outline">
                              Boundary Skip
                            </Badge>
                          ) : (
                            <Badge size="xs" color="indigo" variant="light">
                              Discovered
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text
                            size="xs"
                            fw={item.status === 'crawling' ? 700 : 400}
                            style={{
                              fontFamily: 'monospace',
                              wordBreak: 'break-all',
                            }}
                          >
                            {item.url}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {item.source}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            {filteredDiscoveredUrls.length > 50 && (
              <Text size="xs" c="dimmed" ta="right">
                Showing top 50 of {filteredDiscoveredUrls.length} discovered
                routes
              </Text>
            )}
          </Stack>
        </Card>

        {/* DEVELOPER CONSOLE (LIVE CLI TERMINAL) */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <div>
                <Group gap="xs">
                  <Text fw={700} size="sm">
                    💻 Developer Console & Telemetry Stream
                  </Text>
                  <Badge size="xs" variant="outline">
                    {events.length} events
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  Ordered execution trace from Playwright runner, Bedrock AI,
                  and deterministic checks
                </Text>
              </div>

              <Group gap="xs" wrap="wrap">
                <TextInput
                  size="xs"
                  placeholder="Filter console logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.currentTarget.value)}
                  style={{ width: 180 }}
                />
                <Switch
                  size="xs"
                  label="Autoscroll"
                  checked={autoscroll}
                  onChange={(e) => setAutoscroll(e.currentTarget.checked)}
                />
                <Button size="xs" variant="default" onClick={handleCopyLogs}>
                  {copied ? '✓ Copied' : 'Copy Logs'}
                </Button>
              </Group>
            </Group>

            {/* Event Filter Pills */}
            <Group gap={6} wrap="wrap">
              <Button
                size="xs"
                variant={eventFilter === 'all' ? 'filled' : 'subtle'}
                onClick={() => setEventFilter('all')}
              >
                All ({events.length})
              </Button>
              <Button
                size="xs"
                color="violet"
                variant={eventFilter === 'agent' ? 'filled' : 'subtle'}
                onClick={() => setEventFilter('agent')}
              >
                🧠 Agent Reasoning & Vision
              </Button>
              <Button
                size="xs"
                variant={eventFilter === 'crawl' ? 'filled' : 'subtle'}
                onClick={() => setEventFilter('crawl')}
              >
                🌐 Navigations
              </Button>
              <Button
                size="xs"
                color="orange"
                variant={eventFilter === 'finding' ? 'filled' : 'subtle'}
                onClick={() => setEventFilter('finding')}
              >
                🛡️ Findings ({liveFindings.length})
              </Button>
              <Button
                size="xs"
                color="red"
                variant={eventFilter === 'warn' ? 'filled' : 'subtle'}
                onClick={() => setEventFilter('warn')}
              >
                ⚠️ Warnings & Skips
              </Button>
            </Group>

            {/* Dark Theme CLI Terminal Box */}
            <div
              ref={terminalRef}
              role="log"
              aria-label="Agent live stream terminal"
              className="max-h-[460px] overflow-y-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 shadow-inner"
            >
              {filteredEvents.length === 0 ? (
                <div className="text-slate-500 py-8 text-center">
                  {isScanning
                    ? 'Initializing browser and waiting for incoming agent telemetry...'
                    : 'No matching events.'}
                </div>
              ) : (
                filteredEvents.map((event) => (
                  <div
                    key={event.seq}
                    className="py-0.5 hover:bg-slate-900 flex items-start gap-2"
                  >
                    <span className="text-slate-500 select-none shrink-0 w-12">
                      #{String(event.seq).padStart(4, '0')}
                    </span>
                    <span className="text-slate-500 select-none shrink-0 w-16">
                      {new Date(event.at).toLocaleTimeString()}
                    </span>
                    <span
                      className={`select-none shrink-0 font-bold ${
                        event.level === 'error'
                          ? 'text-red-400'
                          : event.level === 'warn'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      [{event.level.toUpperCase()}]
                    </span>
                    <span className="text-sky-400 font-semibold shrink-0">
                      [{event.phase}]
                    </span>
                    <span className="text-slate-200 break-all">
                      {event.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
