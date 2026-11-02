'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Container,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { apiFetch } from '../../../lib/client';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [origins, setOrigins] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const project = await apiFetch('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          baseUrl,
          approvedOrigins: origins
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean),
          authorizationConfirmed: confirmed,
        }),
      });
      router.push(`/projects/${project.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create project',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Container size="sm" py="xl">
      <Card withBorder padding="xl">
        <form onSubmit={create}>
          <Stack>
            <Title order={1}>New project</Title>
            <Text c="dimmed">
              Only exact origins you approve can be scanned. Use public HTTP or
              HTTPS addresses.
            </Text>
            <TextInput
              label="Project name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <TextInput
              label="Base URL"
              description="Example: https://example.com"
              required
              type="url"
              value={baseUrl}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setBaseUrl(value);
                try {
                  const origin = new URL(value).origin;
                  if (!origins.trim()) setOrigins(origin);
                } catch {
                  /* Wait for a complete URL. */
                }
              }}
            />
            <Textarea
              label="Approved origins"
              description="One exact origin per line, including protocol and port when applicable"
              required
              minRows={3}
              value={origins}
              onChange={(e) => setOrigins(e.currentTarget.value)}
            />
            <Checkbox
              label="I own or am authorized to test every approved origin above"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.currentTarget.checked)}
              required
            />
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <Button type="submit" loading={busy} disabled={!confirmed}>
              Create project
            </Button>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
