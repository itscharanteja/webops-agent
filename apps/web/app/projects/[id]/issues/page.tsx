'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { Issue, Project } from '@webops/contracts';
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
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (pageOffset = 0) => {
      const currentRequest = ++requestId.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          limit: '20',
          offset: String(pageOffset),
          sort,
          direction,
        });
        if (status) query.set('status', status);
        if (priority) query.set('priority', priority);
        if (persona && persona !== 'all') query.set('persona', persona);
        const result = await apiFetch(`/v1/projects/${id}/issues?${query}`);
        if (currentRequest !== requestId.current) return;
        setIssues(result.items);
        setNextOffset(result.nextOffset);
        setError('');
      } catch (cause) {
        if (currentRequest !== requestId.current) return;
        setError(
          cause instanceof Error ? cause.message : 'Could not load issues',
        );
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
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
    setOffset(0);
    void load(0);
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
      void load(offset);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Anchor component={Link} href={`/projects/${id}`}>
          ← {project?.name ?? 'Project'}
        </Anchor>
        <Group justify="space-between">
          <Title order={1}>Issues Board</Title>
          <Badge size="lg">
            {loading ? 'Loading' : `${issues.length} shown`}
          </Badge>
        </Group>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}

        <Card withBorder>
          <Group align="end">
            <Select
              label="Discipline"
              value={persona}
              onChange={(v) => handlePersonaChange(v ?? 'all')}
              data={[
                { value: 'all', label: 'All disciplines' },
                { value: 'ui_ux', label: 'Design & UX' },
                { value: 'frontend', label: 'Frontend' },
                { value: 'backend', label: 'Backend & SRE' },
                { value: 'content_seo', label: 'Content & SEO' },
              ]}
            />
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
          {loading ? (
            <Loader aria-label="Loading issues" />
          ) : issues.length === 0 ? (
            <Text c="dimmed">
              No issues match these filters. A completed scan is needed before
              this is a clean result.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={650}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Issue</Table.Th>

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
            </Table.ScrollContainer>
          )}
        </Card>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {issues.length ? offset + 1 : 0}–{offset + issues.length} shown
          </Text>
          <Group>
            <Button
              variant="default"
              disabled={loading || offset === 0}
              onClick={() => {
                const previous = Math.max(0, offset - 20);
                setOffset(previous);
                void load(previous);
              }}
            >
              Previous
            </Button>
            <Button
              variant="default"
              disabled={loading || nextOffset === null}
              onClick={() => {
                if (nextOffset !== null) {
                  setOffset(nextOffset);
                  void load(nextOffset);
                }
              }}
            >
              Next
            </Button>
          </Group>
        </Group>
      </Stack>
    </Container>
  );
}
