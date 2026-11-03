'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { Project, ProjectDiscordConfig } from '@webops/contracts';
import { disciplines } from '../../../../lib/scan-presentation';
import { apiFetch } from '../../../../lib/client';
export default function IntegrationsPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [scanOptions, setScanOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [sendScan, setSendScan] = useState<string | null>(null);
  const [sendDiscipline, setSendDiscipline] = useState<string | null>(
    'frontend',
  );
  const [sending, setSending] = useState(false);
  const [sendFeedback, setSendFeedback] = useState('');
  useEffect(() => {
    void apiFetch(`/v1/projects/${id}/reports?limit=100`)
      .then((data) =>
        setScanOptions(
          data.items.map((r: { scanId: string; createdAt: string }) => ({
            value: r.scanId,
            label: `${r.scanId.slice(0, 8)} · ${new Date(r.createdAt).toLocaleString()}`,
          })),
        ),
      )
      .catch((cause) => setError(cause.message));
  }, [id]);
  async function sendSummary() {
    if (!sendScan || !sendDiscipline) return;
    setSending(true);
    setSendFeedback('');
    try {
      const data = await apiFetch(`/v1/scans/${sendScan}/dispatch-discord`, {
        method: 'POST',
        body: JSON.stringify({ persona: sendDiscipline }),
      });
      setSendFeedback(data.message || 'Summary sent.');
    } catch (cause) {
      setSendFeedback(
        cause instanceof Error ? cause.message : 'Could not send summary',
      );
    } finally {
      setSending(false);
    }
  }
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
    void apiFetch(`/v1/projects/${id}`)
      .then((data) => {
        setProject(data);
        setWebhooks(data.discordWebhooks ?? {});
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
      setWebhookFeedback('Discord settings saved.');
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
        message: 'Test message delivered.',
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

  return (
    <Container size="md" py="xl">
      <Stack>
        <Anchor component={Link} href={`/projects/${id}`}>
          {project?.name ?? 'Project'}
        </Anchor>
        <Title order={1}>Integrations</Title>
        {error && <Alert color="red">{error}</Alert>}
        {!project && !error && <Loader aria-label="Loading integrations" />}
        {project && (
          <>
            {' '}
            <Card withBorder>
              <Stack>
                <Title order={2}>Send a scan summary</Title>
                <Text size="sm" c="dimmed">
                  Send a saved report to the configured Discord channel for the
                  selected discipline.
                </Text>
                <Select
                  label="Report"
                  placeholder="Choose a saved report"
                  data={scanOptions}
                  value={sendScan}
                  onChange={setSendScan}
                />
                <Select
                  label="Discipline"
                  data={disciplines.filter((d) => d.value !== 'all')}
                  value={sendDiscipline}
                  onChange={setSendDiscipline}
                />
                <Button
                  w="fit-content"
                  disabled={!sendScan}
                  loading={sending}
                  onClick={sendSummary}
                >
                  Send to Discord
                </Button>
                {sendFeedback && (
                  <Text size="sm" role="status">
                    {sendFeedback}
                  </Text>
                )}
              </Stack>
            </Card>
            {/* Discord Webhooks & Channel Dispatch Settings */}
            <Card withBorder padding="lg" radius="md">
              <Stack gap="md">
                <Group justify="space-between">
                  <div>
                    <Title order={2}> Discord</Title>
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
                    Save settings
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
                      label=" UI/UX Design Channel Webhook (#ui-ux-design)"
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
                      label=" Frontend Engineering Webhook (#frontend-bugs)"
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
                      label=" Backend & SRE Webhook (#backend-alerts)"
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
                      label=" Content & SEO Webhook (#content-seo)"
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
                      label=" Default Fallback Webhook (#webops-general)"
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
          </>
        )}
      </Stack>
    </Container>
  );
}
