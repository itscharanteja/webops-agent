import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';

export type TokenVerifier = (token: string) => Promise<string>;

export interface CognitoConfig {
  userPoolId: string;
  region: string;
  clientId?: string | undefined;
}

export function createCognitoVerifier(config: CognitoConfig): TokenVerifier {
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token: string) => {
    // Cognito tokens can be ID tokens (with audience = clientId) or access tokens (client_id claim)
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
    });
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

export function createDevOrMockVerifier(): TokenVerifier {
  return async (token: string) => {
    // Accepts direct UUIDs or unverified decoded JWTs for offline/local testing
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        token,
      )
    ) {
      return token;
    }
    try {
      const decoded = decodeJwt(token);
      if (
        typeof decoded.sub === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          decoded.sub,
        )
      ) {
        return decoded.sub;
      }
    } catch {}
    throw new Error('Invalid authentication token');
  };
}

export interface AuthVerifierOptions {
  cognitoUserPoolId?: string | undefined;
  cognitoRegion?: string | undefined;
  cognitoClientId?: string | undefined;
  supabaseUrl?: string | undefined;
  supabaseAudience?: string | undefined;
}

export function createAuthVerifier(options: AuthVerifierOptions): TokenVerifier {
  if (options.cognitoUserPoolId && options.cognitoRegion) {
    return createCognitoVerifier({
      userPoolId: options.cognitoUserPoolId,
      region: options.cognitoRegion,
      clientId: options.cognitoClientId,
    });
  }
  if (options.supabaseUrl) {
    const base = options.supabaseUrl.replace(/\/$/, '');
    const issuer = `${base}/auth/v1`;
    const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    return async (token) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: options.supabaseAudience ?? 'authenticated',
      });
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
  return createDevOrMockVerifier();
}

// Backwards-compatible export
export function createSupabaseVerifier(
  supabaseUrl: string,
  audience = 'authenticated',
): TokenVerifier {
  return createAuthVerifier({ supabaseUrl, supabaseAudience: audience });
}
