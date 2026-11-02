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
