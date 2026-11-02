import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const auth = supabase();
  if (!auth) throw new Error('Supabase is not configured');
  const { data, error } = await auth.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to continue');
  return fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
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
