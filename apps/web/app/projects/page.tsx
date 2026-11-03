'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { Project } from '@webops/contracts';
import { apiFetch } from '../../lib/client';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    apiFetch('/v1/projects')
      .then((data) => setProjects(data.items))
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDeleteProject() {
    if (!projectToDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/v1/projects/${projectToDelete.id}`, {
        method: 'DELETE',
      });
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      setProjectToDelete(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not delete project',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="center" wrap="wrap">
          <div>
            <Title order={1}>Projects</Title>
            <Text c="dimmed" size="xs">
              Autonomous website auditor and security policy management
            </Text>
          </div>
          <Group gap="xs">
            <Button component={Link} href="/about" variant="default">
              📖 About & Docs
            </Button>
            <Button component={Link} href="/projects/new">
              New project
            </Button>
          </Group>
        </Group>
        {loading && <Loader aria-label="Loading projects" />}
        {error && (
          <Alert color="red" role="alert">
            {error}{' '}
            <Anchor component={Link} href="/login">
              Sign in
            </Anchor>
          </Alert>
        )}
        {!loading && !error && projects.length === 0 && (
          <Text>
            No projects yet. Create one to record your approved scan origins.
          </Text>
        )}
        {projects.map((project) => (
          <Card key={project.id} withBorder padding="lg" radius="md">
            <Group justify="space-between" align="center" wrap="wrap">
              <Stack gap="xs">
                <Anchor
                  component={Link}
                  href={`/projects/${project.id}`}
                  fw={700}
                  size="lg"
                >
                  {project.name}
                </Anchor>
                <Text size="sm" c="dimmed">
                  {project.baseUrl}
                </Text>
                <Text size="xs" c="dimmed">
                  {project.approvedOrigins.length} approved{' '}
                  {project.approvedOrigins.length === 1 ? 'origin' : 'origins'}{' '}
                  · Created {new Date(project.createdAt).toLocaleDateString()}
                </Text>
              </Stack>
              <Group gap="xs">
                <Button
                  component={Link}
                  href={`/projects/${project.id}`}
                  variant="light"
                  size="sm"
                >
                  View Project
                </Button>
                <Button
                  color="red"
                  variant="subtle"
                  size="sm"
                  onClick={() => setProjectToDelete(project)}
                >
                  Delete
                </Button>
              </Group>
            </Group>
          </Card>
        ))}

        {/* Delete Confirmation Modal */}
        <Modal
          opened={!!projectToDelete}
          onClose={() => !deleting && setProjectToDelete(null)}
          title="Delete Project"
          centered
        >
          <Stack gap="md">
            <Text size="sm">
              Are you sure you want to permanently delete{' '}
              <strong>{projectToDelete?.name}</strong>?
            </Text>
            <Alert color="red" title="Irreversible Action">
              This action cannot be undone. All scans, reports, issues, and
              evidence snapshots will be permanently removed.
            </Alert>
            <Group justify="flex-end" gap="xs">
              <Button
                variant="default"
                onClick={() => setProjectToDelete(null)}
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
      </Stack>
    </Container>
  );
}
