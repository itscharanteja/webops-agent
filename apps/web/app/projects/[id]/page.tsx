'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Card,
  Container,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { Project } from '@webops/contracts';
import { apiFetch } from '../../../lib/client';
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void apiFetch(`/v1/projects/${id}`)
      .then(setProject)
      .catch((cause) => setError(cause.message));
  }, [id]);
  return (
    <Container size="md" py="xl">
      <Stack>
        <Anchor component={Link} href="/projects">
          Projects
        </Anchor>
        {error && <Alert color="red">{error}</Alert>}
        {!project && !error && <Text>Loading project…</Text>}
        {project && (
          <>
            <Title order={1}>{project.name}</Title>
            <Card withBorder>
              <Stack>
                <Text>Base URL: {project.baseUrl}</Text>
                <Text fw={700}>Approved origins</Text>
                {project.approvedOrigins.map((origin) => (
                  <Text key={origin}>{origin}</Text>
                ))}
              </Stack>
            </Card>
          </>
        )}
      </Stack>
    </Container>
  );
}
