import { getStoredSession } from './cognito';

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const session = getStoredSession();
  if (!session?.accessToken) {
    throw new Error('Sign in to continue');
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${session.accessToken}`,
    ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL !== undefined
      ? process.env.NEXT_PUBLIC_API_URL
      : typeof window !== 'undefined'
        ? ''
        : 'http://localhost:4000';

  return fetch(
    `${apiBase}${path}`,
    {
      ...init,
      headers,
    },
  );
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await authorizedFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return response.json();
}

export async function apiBlob(path: string): Promise<Blob> {
  const response = await authorizedFetch(path);
  if (!response.ok) throw new Error(`Proof unavailable (${response.status})`);
  return response.blob();
}

export async function downloadIssueMarkdown(issueId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/issues/${issueId}/markdown`);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const header = response.headers.get('content-disposition') ?? '';
  const filename =
    /^attachment; filename="([a-z0-9-]+\.md)"$/i.exec(header)?.[1] ??
    `issue-${issueId}.md`;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function apiStream(
  path: string,
  after: number,
  signal: AbortSignal,
) {
  return authorizedFetch(path, {
    signal,
    headers: { accept: 'text/event-stream', 'Last-Event-ID': String(after) },
  });
}
