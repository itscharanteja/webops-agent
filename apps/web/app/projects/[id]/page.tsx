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
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { Project, Scan } from '@webops/contracts';
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
  useEffect(() => {
    Promise.all([
      apiFetch(`/v1/projects/${id}`),
      apiFetch(`/v1/projects/${id}/scans`),
    ])
      .then(([projectData, scanData]) => {
        setProject(projectData);
        setScans(scanData.items);
      })
      .catch((cause) => setError(cause.message));
  }, [id]);
  async function startScan() {
    setBusy(true);
    setError('');
    try {
      const scan = await apiFetch(`/v1/projects/${id}/scans`, {
        method: 'POST',
      });
      router.push(`/projects/${id}/scans/${scan.id}`);
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
                              href={`/projects/${id}/scans/${scan.id}`}
                            >
                              Open scan
                            </Anchor>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
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
