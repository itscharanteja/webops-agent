'use client';

import { useCallback, useEffect, useState } from 'react';
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
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import type { IssueDetail } from '@webops/contracts';
import { apiFetch, downloadIssueMarkdown } from '../../../../../lib/client';

export default function IssuePage() {
  const { id, issueId } = useParams<{ id: string; issueId: string }>();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data: IssueDetail = await apiFetch(`/v1/issues/${issueId}`);
      setIssue(data);
      setTitle(data.title);
      setDescription(data.description);
      setPriority(data.priority);
      setStatus(data.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load issue');
    }
  }, [issueId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!issue) return;
    setBusy(true);
    setError('');
    try {
      const updated: IssueDetail = await apiFetch(`/v1/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'If-Match': String(issue.version) },
        body: JSON.stringify({ title, description, priority, status }),
      });
      setIssue(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save issue');
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setError('');
    try {
      await downloadIssueMarkdown(issueId);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not download issue',
      );
    }
  }
  const latest = issue?.observations[0];
  const explanation = latest?.explanation ?? {};

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Anchor component={Link} href={`/projects/${id}/issues`}>
          ← Issues
        </Anchor>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {!issue ? (
          <Text>Loading issue…</Text>
        ) : (
          <>
            <Group justify="space-between">
              <Title order={1}>{issue.title}</Title>
              <Button variant="light" onClick={() => void download()}>
                Download .md
              </Button>
            </Group>
            <Text size="sm" c="dimmed" className="break-all">
              {issue.affectedUrl}
            </Text>
            <Group>
              <Badge>{issue.latestRuleId}</Badge>
              <Badge color="gray">Confidence {issue.confidence ?? '—'}</Badge>
              <Text size="sm">
                First seen {new Date(issue.firstSeen).toLocaleString()} · Last
                seen {new Date(issue.lastSeen).toLocaleString()}
              </Text>
            </Group>
            <Card withBorder>
              <Stack>
                <Title order={2}>Edit issue</Title>
                <TextInput
                  label="Title"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  maxLength={200}
                />
                <Textarea
                  label="Description"
                  value={description}
                  onChange={(event) =>
                    setDescription(event.currentTarget.value)
                  }
                  minRows={3}
                  maxLength={4000}
                />
                <Group>
                  <Select
                    label="Priority"
                    value={priority}
                    onChange={setPriority}
                    data={['P0', 'P1', 'P2', 'P3']}
                  />
                  <Select
                    label="Status"
                    value={status}
                    onChange={setStatus}
                    data={[
                      { value: 'open', label: 'Open' },
                      { value: 'in_progress', label: 'In progress' },
                      { value: 'resolved', label: 'Resolved' },
                      { value: 'wont_fix', label: "Won't fix" },
                    ]}
                  />
                </Group>
                <Group>
                  <Button onClick={() => void save()} loading={busy}>
                    Save changes
                  </Button>
                  <Text size="sm" c="dimmed">
                    Version {issue.version}
                  </Text>
                </Group>
              </Stack>
            </Card>
            {latest && (
              <Card withBorder>
                <Stack>
                  <Title order={2}>Latest observation</Title>
                  <Text>
                    <strong>Exact observation:</strong>{' '}
                    {String(explanation.observed ?? 'Unavailable')}
                  </Text>
                  <Text>
                    <strong>Impact:</strong>{' '}
                    {String(explanation.impact ?? 'Unavailable')}
                  </Text>
                  <Text fw={700}>Reproduction steps</Text>
                  <ol className="list-decimal pl-6">
                    {Array.isArray(explanation.reproductionSteps) &&
                      explanation.reproductionSteps.map((step, index) => (
                        <li key={index}>{String(step)}</li>
                      ))}
                  </ol>
                  <Text>
                    <strong>Suggested fix:</strong>{' '}
                    {String(explanation.suggestedFix ?? 'Unavailable')}
                  </Text>
                  <Text size="sm">
                    Rule {latest.ruleId} v{latest.ruleVersion} · Detected
                    severity {latest.detectedSeverity} · Scan{' '}
                    {new Date(latest.createdAt).toLocaleString()}
                  </Text>
                  <Text fw={700}>Proof</Text>
                  <Group>
                    {latest.citations.map((citation) => (
                      <Anchor
                        key={citation.evidenceId}
                        component={Link}
                        href={`/projects/${id}/scans/${latest.scanId}/evidence/${citation.evidenceId}`}
                      >
                        {citation.kind}: {citation.label}
                      </Anchor>
                    ))}
                  </Group>
                </Stack>
              </Card>
            )}
            <Card withBorder>
              <Stack>
                <Title order={2}>Observation timeline</Title>
                {issue.observations.map((observation) => (
                  <div key={observation.id}>
                    <Text fw={700}>
                      {observation.ruleId} ·{' '}
                      {new Date(observation.createdAt).toLocaleString()}
                    </Text>
                    <Text size="sm">
                      {String(observation.explanation.observed ?? '')}
                    </Text>
                    <Group>
                      {observation.citations.map((citation) => (
                        <Anchor
                          key={citation.evidenceId}
                          component={Link}
                          href={`/projects/${id}/scans/${observation.scanId}/evidence/${citation.evidenceId}`}
                        >
                          {citation.kind} proof
                        </Anchor>
                      ))}
                    </Group>
                  </div>
                ))}
              </Stack>
            </Card>
            {issue.revisions.length > 0 && (
              <Card withBorder>
                <Stack>
                  <Title order={2}>Edit history</Title>
                  {issue.revisions.map((revision) => (
                    <Text key={revision.version} size="sm">
                      Version {revision.version} ·{' '}
                      {new Date(revision.at).toLocaleString()} · Editor{' '}
                      {revision.editorId}
                    </Text>
                  ))}
                </Stack>
              </Card>
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
