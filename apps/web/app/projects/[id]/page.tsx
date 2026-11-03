'use client';

import { useEffect, useState } from 'react';
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
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { Project, ProjectDiscordConfig, Scan } from '@webops/contracts';
import { apiFetch } from '../../../lib/client';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteOpened, setDeleteOpened] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Webhook settings state
  const [webhooks, setWebhooks] = useState<ProjectDiscordConfig>({});
  const [savingWebhooks, setSavingWebhooks] = useState(false);
  const [webhookFeedback, setWebhookFeedback] = useState<string | null>(null);
  const [testingTrack, setTestingTrack] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    track: string;
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch(`/v1/projects/${id}`),
      apiFetch(`/v1/projects/${id}/scans`),
    ])
      .then(([projectData, scanData]) => {
        setProject(projectData);
        setScans(scanData.items);
        if (projectData.discordWebhooks) {
          setWebhooks(projectData.discordWebhooks);
        }
      })
      .catch((cause) => setError(cause.message));
  }, [id]);

  async function handleSaveWebhooks() {
    setSavingWebhooks(true);
    setWebhookFeedback(null);
    try {
      const updated: Project = await apiFetch(`/v1/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          discordWebhooks: webhooks,
        }),
      });
      setProject(updated);
      setWebhookFeedback('Discord Webhooks successfully saved!');
    } catch (cause) {
      setWebhookFeedback(
        cause instanceof Error
          ? `Error: ${cause.message}`
          : 'Failed to save webhooks',
      );
    } finally {
      setSavingWebhooks(false);
    }
  }

  async function handleTestPing(track: string, urlStr?: string) {
    if (!urlStr) return;
    setTestingTrack(track);
    setTestResult(null);
    try {
      await apiFetch(`/v1/projects/${id}/discord/test`, {
        method: 'POST',
        body: JSON.stringify({
          webhookUrl: urlStr,
          track,
        }),
      });
      setTestResult({
        track,
        success: true,
        message: 'Ping delivered to Discord channel!',
      });
    } catch (cause) {
      setTestResult({
        track,
        success: false,
        message:
          cause instanceof Error ? cause.message : 'Test delivery failed',
      });
    } finally {
      setTestingTrack(null);
    }
  }
  async function startScan() {
    setBusy(true);
    setError('');
    try {
      const scan = await apiFetch(`/v1/projects/${id}/scans`, {
        method: 'POST',
      });
      router.push(`/projects/${id}/scans/${scan.id}/live`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start scan');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject() {
    setDeleting(true);
    setError('');
    try {
      await apiFetch(`/v1/projects/${id}`, { method: 'DELETE' });
      router.push('/projects');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not delete project',
      );
      setDeleting(false);
      setDeleteOpened(false);
    }
  }
  return (
    <Container size="md" py="xl">
      <Stack>
        <Anchor component={Link} href="/projects">
          Projects
        </Anchor>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {!project && !error && <Loader aria-label="Loading project" />}
        {project && (
          <>
            <Group justify="space-between" align="center">
              <Title order={1}>{project.name}</Title>
              <Group>
                <Button
                  component={Link}
                  href={`/projects/${id}/issues`}
                  variant="light"
                >
                  Issues board
                </Button>
                <Button
                  component={Link}
                  href={`/projects/${id}/reports`}
                  variant="light"
                >
                  Reports
                </Button>
                <Button onClick={startScan} loading={busy}>
                  Start scan
                </Button>
                <Button
                  color="red"
                  variant="subtle"
                  onClick={() => setDeleteOpened(true)}
                >
                  Delete project
                </Button>
              </Group>
            </Group>
            <Card withBorder>
              <Stack gap="xs">
                <Text>
                  <strong>Base URL:</strong> {project.baseUrl}
                </Text>
                <Text fw={700}>Approved origins</Text>
                {project.approvedOrigins.map((origin) => (
                  <Text key={origin}>{origin}</Text>
                ))}
              </Stack>
            </Card>
            <Card withBorder>
              <Stack>
                <Title order={2}>Scans</Title>
                {scans.length === 0 ? (
                  <Text c="dimmed">No scans yet.</Text>
                ) : (
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Started</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Pages</Table.Th>
                        <Table.Th>Details</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {scans.map((scan) => (
                        <Table.Tr key={scan.id}>
                          <Table.Td>
                            {new Date(scan.queuedAt).toLocaleString()}
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              color={
                                scan.status === 'completed'
                                  ? 'green'
                                  : scan.status === 'running'
                                    ? 'blue'
                                    : 'orange'
                              }
                            >
                              {scan.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{scan.visitedCount}</Table.Td>
                          <Table.Td>
                            <Anchor
                              component={Link}
                              href={
                                scan.status === 'running' ||
                                scan.status === 'queued'
                                  ? `/projects/${id}/scans/${scan.id}/live`
                                  : `/projects/${id}/scans/${scan.id}`
                              }
                              fw={
                                scan.status === 'running' ||
                                scan.status === 'queued'
                                  ? 600
                                  : 400
                              }
                            >
                              {scan.status === 'running' ||
                              scan.status === 'queued'
                                ? '⚡ View Live Scan Progress'
                                : 'Open scan report'}
                            </Anchor>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>
            </Card>

            {/* Discord Webhooks & Channel Dispatch Settings */}
            <Card withBorder padding="lg" radius="md">
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Title order={2}>📡 Role-Targeted Discord Webhooks</Title>
                    <Text size="sm" c="dimmed">
                      Route audited findings and deliverables directly to
                      dedicated team channels in Discord.
                    </Text>
                  </div>
                  <Button
                    onClick={handleSaveWebhooks}
                    loading={savingWebhooks}
                    color="indigo"
                  >
                    Save Webhook Settings
                  </Button>
                </Group>

                {webhookFeedback && (
                  <Alert
                    color={
                      webhookFeedback.startsWith('Error') ? 'red' : 'green'
                    }
                  >
                    {webhookFeedback}
                  </Alert>
                )}

                {testResult && (
                  <Alert
                    color={testResult.success ? 'green' : 'red'}
                    title={`Ping result for ${testResult.track}`}
                  >
                    {testResult.message}
                  </Alert>
                )}

                <Stack gap="sm">
                  {/* UI/UX Design Webhook */}
                  <Group align="flex-end" grow>
                    <TextInput
                      label="🎨 UI/UX Design Channel Webhook (#ui-ux-design)"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={webhooks.uiUxWebhookUrl ?? ''}
                      onChange={(e) =>
                        setWebhooks((prev) => ({
                          ...prev,
                          uiUxWebhookUrl: e.target.value.trim() || undefined,
                        }))
                      }
                    />
                    <Button
                      style={{ flexGrow: 0 }}
                      variant="light"
                      color="violet"
                      disabled={!webhooks.uiUxWebhookUrl}
                      loading={testingTrack === 'ui_ux'}
                      onClick={() =>
                        handleTestPing('ui_ux', webhooks.uiUxWebhookUrl)
                      }
                    >
                      Test Ping
                    </Button>
                  </Group>

                  {/* Frontend Webhook */}
                  <Group align="flex-end" grow>
                    <TextInput
                      label="💻 Frontend Engineering Webhook (#frontend-bugs)"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={webhooks.frontendWebhookUrl ?? ''}
                      onChange={(e) =>
                        setWebhooks((prev) => ({
                          ...prev,
                          frontendWebhookUrl:
                            e.target.value.trim() || undefined,
                        }))
                      }
                    />
                    <Button
                      style={{ flexGrow: 0 }}
                      variant="light"
                      color="blue"
                      disabled={!webhooks.frontendWebhookUrl}
                      loading={testingTrack === 'frontend'}
                      onClick={() =>
                        handleTestPing('frontend', webhooks.frontendWebhookUrl)
                      }
                    >
                      Test Ping
                    </Button>
                  </Group>

                  {/* Backend Webhook */}
                  <Group align="flex-end" grow>
                    <TextInput
                      label="⚙️ Backend & SRE Webhook (#backend-alerts)"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={webhooks.backendWebhookUrl ?? ''}
                      onChange={(e) =>
                        setWebhooks((prev) => ({
                          ...prev,
                          backendWebhookUrl: e.target.value.trim() || undefined,
                        }))
                      }
                    />
                    <Button
                      style={{ flexGrow: 0 }}
                      variant="light"
                      color="red"
                      disabled={!webhooks.backendWebhookUrl}
                      loading={testingTrack === 'backend'}
                      onClick={() =>
                        handleTestPing('backend', webhooks.backendWebhookUrl)
                      }
                    >
                      Test Ping
                    </Button>
                  </Group>

                  {/* Content & SEO Webhook */}
                  <Group align="flex-end" grow>
                    <TextInput
                      label="📝 Content & SEO Webhook (#content-seo)"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={webhooks.contentSeoWebhookUrl ?? ''}
                      onChange={(e) =>
                        setWebhooks((prev) => ({
                          ...prev,
                          contentSeoWebhookUrl:
                            e.target.value.trim() || undefined,
                        }))
                      }
                    />
                    <Button
                      style={{ flexGrow: 0 }}
                      variant="light"
                      color="green"
                      disabled={!webhooks.contentSeoWebhookUrl}
                      loading={testingTrack === 'content_seo'}
                      onClick={() =>
                        handleTestPing(
                          'content_seo',
                          webhooks.contentSeoWebhookUrl,
                        )
                      }
                    >
                      Test Ping
                    </Button>
                  </Group>

                  {/* Default Webhook */}
                  <Group align="flex-end" grow>
                    <TextInput
                      label="🛡️ Default Fallback Webhook (#webops-general)"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={webhooks.defaultWebhookUrl ?? ''}
                      onChange={(e) =>
                        setWebhooks((prev) => ({
                          ...prev,
                          defaultWebhookUrl: e.target.value.trim() || undefined,
                        }))
                      }
                    />
                    <Button
                      style={{ flexGrow: 0 }}
                      variant="light"
                      disabled={!webhooks.defaultWebhookUrl}
                      loading={testingTrack === 'general'}
                      onClick={() =>
                        handleTestPing('general', webhooks.defaultWebhookUrl)
                      }
                    >
                      Test Ping
                    </Button>
                  </Group>
                </Stack>
              </Stack>
            </Card>

            {/* Danger Zone */}
            <Card
              withBorder
              padding="lg"
              radius="md"
              style={{ borderColor: 'var(--mantine-color-red-4)' }}
            >
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Text fw={700} c="red.9">
                    Danger Zone
                  </Text>
                  <Text size="sm" c="dimmed">
                    Permanently delete this project and all its associated
                    scans, reports, issues, and evidence.
                  </Text>
                </div>
                <Button
                  color="red"
                  variant="light"
                  onClick={() => setDeleteOpened(true)}
                >
                  Delete Project
                </Button>
              </Group>
            </Card>

            {/* Confirmation Modal */}
            <Modal
              opened={deleteOpened}
              onClose={() => !deleting && setDeleteOpened(false)}
              title="Delete Project"
              centered
            >
              <Stack gap="md">
                <Text size="sm">
                  Are you sure you want to permanently delete{' '}
                  <strong>{project.name}</strong>?
                </Text>
                <Alert color="red" title="Irreversible Action">
                  This action cannot be undone. All scans, reports, issues board
                  entries, and evidence snapshots will be permanently removed.
                </Alert>
                <Group justify="flex-end" gap="xs">
                  <Button
                    variant="default"
                    onClick={() => setDeleteOpened(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="red"
                    onClick={handleDeleteProject}
                    loading={deleting}
                  >
                    Delete Permanently
                  </Button>
                </Group>
              </Stack>
            </Modal>
          </>
        )}
      </Stack>
    </Container>
  );
}
