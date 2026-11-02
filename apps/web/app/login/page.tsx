'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Container,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { supabase } from '../../lib/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const client = supabase();
      if (!client) throw new Error('Supabase is not configured');
      const result = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/projects` },
      });
      if (result.error) throw result.error;
      setMessage('Check your email for a sign-in link.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Container size="xs" py="xl">
      <Card shadow="sm" padding="xl" radius="md">
        <form onSubmit={signIn}>
          <Stack>
            <Title order={1}>Sign in to WebOps</Title>
            <Text c="dimmed">
              Use your account email to manage authorized website scans.
            </Text>
            <TextInput
              label="Email address"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            {message && (
              <Alert color="green" role="status">
                {message}
              </Alert>
            )}
            <Button type="submit" loading={busy}>
              Email sign-in link
            </Button>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
