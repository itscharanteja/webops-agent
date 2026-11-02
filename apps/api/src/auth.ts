import { createRemoteJWKSet, jwtVerify } from 'jose';

export type TokenVerifier = (token: string) => Promise<string>;

export function createSupabaseVerifier(
  supabaseUrl: string,
  audience = 'authenticated',
): TokenVerifier {
  const base = supabaseUrl.replace(/\/$/, '');
  const issuer = `${base}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    if (
      typeof payload.sub !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.sub,
      )
    ) {
      throw new Error('Invalid JWT subject');
    }
    return payload.sub;
  };
}
