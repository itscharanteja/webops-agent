'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Container,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { Issue, Project, TargetPersona } from '@webops/contracts';
import { apiFetch } from '../../../../lib/client';

export default function IssuesBoard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPersona = searchParams.get('persona') || 'all';

  const [project, setProject] = useState<Project | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [persona, setPersona] = useState<string>(initialPersona);
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [sort, setSort] = useState('last_seen');
  const [direction, setDirection] = useState('desc');
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      try {
        const query = new URLSearchParams({
          limit: '20',
          offset: String(offset),
          sort,
          direction,
        });
        if (status) query.set('status', status);
        if (priority) query.set('priority', priority);
        if (persona && persona !== 'all') query.set('persona', persona);
        const result = await apiFetch(`/v1/projects/${id}/issues?${query}`);
        setIssues((previous) =>
          offset === 0 ? result.items : [...previous, ...result.items],
        );
        setNextOffset(result.nextOffset);
        setError('');
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Could not load issues',
        );
      }
    },
    [id, status, priority, persona, sort, direction],
  );

  useEffect(() => {
    void apiFetch(`/v1/projects/${id}`)
      .then(setProject)
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePersonaChange = (val: string) => {
    setPersona(val);
    const params = new URLSearchParams(window.location.search);
    if (val === 'all') params.delete('persona');
    else params.set('persona', val);
    router.replace(`?${params.toString()}`);
  };

  async function edit(issue: Issue, patch: Record<string, string>) {
    setBusy(issue.id);
    setError('');
    try {
      const updated: Issue = await apiFetch(`/v1/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'If-Match': String(issue.version) },
        body: JSON.stringify(patch),
      });
      setIssues((items) =>
        items.map((item) => (item.id === issue.id ? updated : item)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update issue',
      );
      void load();
    } finally {
      setBusy(null);
    }
  }

  const getPersonaBadge = (p?: TargetPersona | string | null) => {
    switch (p) {
      case 'ui_ux':
        return (
          <Badge color="violet" size="xs" variant="light">
            🎨 Design
          </Badge>
        );
      case 'backend':
        return (
          <Badge color="red" size="xs" variant="light">
            ⚙️ Backend
          </Badge>
        );
      case 'content_seo':
        return (
          <Badge color="green" size="xs" variant="light">
            📝 Content
          </Badge>
        );
      case 'frontend':
      default:
        return (
          <Badge color="blue" size="xs" variant="light">
            💻 Frontend
          </Badge>
        );
    }
  };

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Anchor component={Link} href={`/projects/${id}`}>
          ← {project?.name ?? 'Project'}
        </Anchor>
        <Group justify="space-between">
          <Title order={1}>Issues Board</Title>
          <Badge size="lg">{issues.length} shown</Badge>
        </Group>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}

        {/* Persona Pill / Discipline Selector */}
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Filter by Target Persona / Discipline
            </Text>
            <SegmentedControl
              value={persona}
              onChange={handlePersonaChange}
              data={[
                { label: 'All Disciplines', value: 'all' },
                { label: '🎨 Design & UX', value: 'ui_ux' },
                { label: '💻 Frontend', value: 'frontend' },
                { label: '⚙️ Backend & SRE', value: 'backend' },
                { label: '📝 Content & SEO', value: 'content_seo' },
              ]}
              color="indigo"
              fullWidth
            />
          </Stack>
        </Card>

        <Card withBorder>
          <Group align="end">
            <Select
              label="Status filter"
              clearable
              value={status}
              onChange={setStatus}
              data={[
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'wont_fix', label: "Won't fix" },
              ]}
            />
            <Select
              label="Priority filter"
              clearable
              value={priority}
              onChange={setPriority}
              data={['P0', 'P1', 'P2', 'P3']}
            />
            <Select
              label="Sort by"
              value={sort}
              onChange={(value) => setSort(value ?? 'last_seen')}
              data={[
                { value: 'last_seen', label: 'Last seen' },
                { value: 'priority', label: 'Priority' },
                { value: 'status', label: 'Status' },
              ]}
            />
            <Select
              label="Order"
              value={direction}
              onChange={(value) => setDirection(value ?? 'desc')}
              data={[
                { value: 'desc', label: 'Descending' },
                { value: 'asc', label: 'Ascending' },
              ]}
            />
          </Group>
        </Card>
        <Card withBorder>
          {issues.length === 0 ? (
            <Text c="dimmed">
              No issues match these filters. A completed scan is needed before
              this is a clean result.
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Issue</Table.Th>
                  <Table.Th>Track</Table.Th>
                  <Table.Th>Rule</Table.Th>
                  <Table.Th>Priority</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {issues.map((issue) => (
                  <Table.Tr key={issue.id}>
                    <Table.Td>
                      <Stack gap={2}>
                        <Group gap="xs">
                          <Anchor
                            component={Link}
                            href={`/projects/${id}/issues/${issue.id}`}
                          >
                            {issue.title}
                          </Anchor>
                          {issue.notSeen && (
                            <Badge color="orange" size="xs">
                              Not seen
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" className="break-all">
                          {issue.affectedUrl}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>{getPersonaBadge(issue.targetPersona)}</Table.Td>
                    <Table.Td>
                      <Text size="xs">{issue.latestRuleId}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={`Priority for ${issue.title}`}
                        size="xs"
                        w={85}
                        value={issue.priority}
                        disabled={busy === issue.id}
                        onChange={(value) => {
                          if (value) void edit(issue, { priority: value });
                        }}
                        data={['P0', 'P1', 'P2', 'P3']}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={`Status for ${issue.title}`}
                        size="xs"
                        w={145}
                        value={issue.status}
                        disabled={busy === issue.id}
                        onChange={(value) => {
                          if (value) void edit(issue, { status: value });
                        }}
                        data={[
                          { value: 'open', label: 'Open' },
                          { value: 'in_progress', label: 'In progress' },
                          { value: 'resolved', label: 'Resolved' },
                          { value: 'wont_fix', label: "Won't fix" },
                        ]}
                      />
                    </Table.Td>
                    <Table.Td>
                      {new Date(issue.lastSeen).toLocaleDateString()}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
        {nextOffset !== null && (
          <Button variant="light" onClick={() => void load(nextOffset)}>
            Load more
          </Button>
        )}
      </Stack>
    </Container>
  );
}
