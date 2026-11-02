'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { Evidence } from '@webops/contracts';
import { apiBlob, apiFetch } from '../../../../../../../lib/client';

export default function ProofViewer() {
  const { id, scanId, evidenceId } = useParams<{
    id: string;
    scanId: string;
    evidenceId: string;
  }>();
  const [proof, setProof] = useState<Evidence | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl: string | null = null;
    let stopped = false;
    async function load() {
      try {
        const data: Evidence = await apiFetch(`/v1/evidence/${evidenceId}`);
        if (data.projectId !== id || data.scanId !== scanId)
          throw new Error('Proof does not belong to this scan');
        if (stopped) return;
        setProof(data);
        if (data.kind === 'screenshot' && data.available && data.artifactUrl) {
          if (data.artifactUrl.startsWith('/v1/')) {
            const blob = await apiBlob(data.artifactUrl);
            objectUrl = URL.createObjectURL(blob);
            if (!stopped) setImageUrl(objectUrl);
          } else setImageUrl(data.artifactUrl);
        }
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error ? cause.message : 'Could not load proof',
          );
      }
    }
    void load();
    return () => {
      stopped = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, scanId, evidenceId]);

  const box = proof?.payload.boundingBox as
    | { x: number; y: number; width: number; height: number }
    | undefined;
  const excerpt =
    proof?.kind === 'dom'
      ? String(proof.payload.excerpt ?? proof.payload.anchorText ?? '')
      : null;
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group>
          <Anchor component={Link} href={`/projects/${id}/scans/${scanId}`}>
            ← Scan
          </Anchor>
          {proof?.issueIds.map((issueId) => (
            <Anchor
              key={issueId}
              component={Link}
              href={`/projects/${id}/issues/${issueId}`}
            >
              Issue {issueId.slice(0, 8)}
            </Anchor>
          ))}
        </Group>
        <Title order={1}>Proof viewer</Title>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {!proof && !error && <Text>Loading proof…</Text>}
        {proof && (
          <>
            <Card withBorder>
              <Stack gap="xs">
                <Group>
                  <Badge>{proof.kind}</Badge>
                  {proof.ruleIds.map((rule) => (
                    <Badge key={rule} color="gray">
                      {rule}
                    </Badge>
                  ))}
                </Group>
                <Text>
                  <strong>Source page:</strong>{' '}
                  {proof.sourceUrl ?? 'Unavailable'}
                </Text>
                <Text>
                  <strong>Captured:</strong>{' '}
                  {new Date(proof.capturedAt).toLocaleString()}
                </Text>
                {proof.locator && (
                  <Text>
                    <strong>Locator:</strong> <code>{proof.locator}</code>
                  </Text>
                )}
                {proof.retainedUntil && (
                  <Text size="sm" c="dimmed">
                    <strong>Retention:</strong>{' '}
                    {new Date(proof.retainedUntil).getTime() > Date.now()
                      ? `Retained until ${new Date(proof.retainedUntil).toLocaleDateString()}`
                      : `Retention expired on ${new Date(proof.retainedUntil).toLocaleDateString()}`}
                  </Text>
                )}
                {box && (
                  <Text size="sm">
                    Bounding box: x {Math.round(box.x)}, y {Math.round(box.y)},
                    width {Math.round(box.width)}, height{' '}
                    {Math.round(box.height)}
                  </Text>
                )}
              </Stack>
            </Card>
            {!proof.available &&
            proof.retainedUntil &&
            new Date(proof.retainedUntil).getTime() <= Date.now() ? (
              <Alert color="gray" title="Proof retention expired">
                The artifact was safely removed per the 90-day retention
                schedule (expired on{' '}
                {new Date(proof.retainedUntil).toLocaleDateString()}). Finding
                and audit metadata remain preserved.
              </Alert>
            ) : !proof.available ? (
              <Alert color="orange" title="Proof unavailable">
                This artifact could not be verified or is no longer retained.
              </Alert>
            ) : null}
            {proof.available && proof.kind === 'screenshot' && (
              <Card withBorder>
                <Stack>
                  <Title order={2}>Screenshot</Title>
                  {imageUrl ? (
                    <div className={box ? 'border-4 border-red-500' : ''}>
                      <img
                        src={imageUrl}
                        alt={`Screenshot proof from ${proof.sourceUrl ?? 'scanned page'}`}
                        className="max-w-full"
                        onError={() =>
                          setError(
                            'Proof unavailable: screenshot could not be loaded',
                          )
                        }
                      />
                    </div>
                  ) : (
                    <Text>Loading image…</Text>
                  )}
                </Stack>
              </Card>
            )}
            {proof.available && proof.kind === 'dom' && (
              <Card withBorder>
                <Stack>
                  <Title order={2}>DOM excerpt</Title>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-slate-100 p-4 text-sm">
                    {excerpt}
                  </pre>
                </Stack>
              </Card>
            )}
            {proof.available &&
              ['console', 'network', 'url'].includes(proof.kind) && (
                <Card withBorder>
                  <Stack>
                    <Title order={2}>
                      {proof.kind === 'console'
                        ? 'Console message'
                        : proof.kind === 'network'
                          ? 'Network event'
                          : 'URL result'}
                    </Title>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-slate-100 p-4 text-sm">
                      {JSON.stringify(proof.payload, null, 2)}
                    </pre>
                  </Stack>
                </Card>
              )}
          </>
        )}
      </Stack>
    </Container>
  );
}
