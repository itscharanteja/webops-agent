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
  useEffect(() => {
    apiFetch('/v1/projects')
      .then((data) => setProjects(data.items))
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>Projects</Title>
          <Button component={Link} href="/projects/new">
            New project
          </Button>
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
          <Card key={project.id} withBorder padding="lg">
            <Stack gap="xs">
              <Anchor
                component={Link}
                href={`/projects/${project.id}`}
                fw={700}
              >
                {project.name}
              </Anchor>
              <Text size="sm" c="dimmed">
                {project.baseUrl}
              </Text>
              <Text size="sm">
                {project.approvedOrigins.length} approved{' '}
                {project.approvedOrigins.length === 1 ? 'origin' : 'origins'}
              </Text>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Container>
  );
}
