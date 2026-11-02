'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  Container,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  cognitoSignIn,
  cognitoSignUp,
  cognitoConfirmSignUp,
  isCognitoConfigured,
} from '../../lib/cognito';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'confirm'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);

    try {
      if (mode === 'signin') {
        await cognitoSignIn(email, password);
        router.push('/projects');
      } else if (mode === 'signup') {
        const result = await cognitoSignUp(email, password);
        if (result.userConfirmed) {
          setMessage('Account created! Signing in...');
          await cognitoSignIn(email, password);
          router.push('/projects');
        } else {
          setMessage('Verification code sent to your email.');
          setMode('confirm');
        }
      } else if (mode === 'confirm') {
        await cognitoConfirmSignUp(email, confirmCode);
        setMessage('Email verified! Signing in...');
        await cognitoSignIn(email, password);
        router.push('/projects');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  function handleDevBypass() {
    cognitoSignIn(email || 'developer@webops.internal', 'dev-password').then(
      () => {
        router.push('/projects');
      },
    );
  }

  return (
    <Container size="xs" py="xl">
      <Card shadow="sm" padding="xl" radius="md" withBorder>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Title order={2}>
              {mode === 'signin' && 'Sign in to WebOps'}
              {mode === 'signup' && 'Create WebOps Account'}
              {mode === 'confirm' && 'Verify Your Email'}
            </Title>
            <Text c="dimmed" size="sm">
              {mode === 'confirm'
                ? `Enter the verification code sent to ${email}`
                : 'AWS Cognito authenticated access to your security scan projects.'}
            </Text>

            {mode !== 'confirm' ? (
              <>
                <TextInput
                  label="Email address"
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Password"
                  required
                  placeholder="Min 8 chars"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
              </>
            ) : (
              <TextInput
                label="Confirmation code"
                required
                placeholder="123456"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.currentTarget.value)}
              />
            )}

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

            <Button type="submit" loading={busy} fullWidth>
              {mode === 'signin' && 'Sign In'}
              {mode === 'signup' && 'Sign Up'}
              {mode === 'confirm' && 'Confirm Code & Enter'}
            </Button>

            <Group justify="space-between" mt="xs">
              {mode === 'signin' ? (
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => {
                    setMode('signup');
                    setError('');
                    setMessage('');
                  }}
                >
                  Need an account? Sign Up
                </Button>
              ) : (
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => {
                    setMode('signin');
                    setError('');
                    setMessage('');
                  }}
                >
                  Already have an account? Sign In
                </Button>
              )}
            </Group>

            {!isCognitoConfigured() && (
              <>
                <Divider label="Local Development" labelPosition="center" />
                <Button
                  variant="light"
                  color="gray"
                  size="sm"
                  onClick={handleDevBypass}
                >
                  One-Click Dev Sign-In
                </Button>
              </>
            )}
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
