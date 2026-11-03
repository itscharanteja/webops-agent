import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';

export type TokenVerifier = (token: string) => Promise<string>;

export interface CognitoConfig {
  userPoolId: string;
  region: string;
  clientId?: string | undefined;
}

export const DEV_DEFAULT_USER_ID = 'a0000000-0000-4000-8000-000000000001';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCognitoVerifier(config: CognitoConfig): TokenVerifier {
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
    });
    if (typeof payload.sub !== 'string' || !UUID_REGEX.test(payload.sub)) {
      throw new Error('Invalid JWT subject');
    }
    return payload.sub;
  };
}

export function createDevOrMockVerifier(): TokenVerifier {
  return async (token: string) => {
    if (
      token === 'dev-token' ||
      token === '00000000-0000-0000-0000-000000000001' ||
      token === DEV_DEFAULT_USER_ID
    ) {
      return DEV_DEFAULT_USER_ID;
    }
    // Accepts any standard 36-char hex UUID for dev/test mode
    if (UUID_REGEX.test(token)) {
      return token;
    }
    try {
      const decoded = decodeJwt(token);
      if (typeof decoded.sub === 'string' && UUID_REGEX.test(decoded.sub)) {
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

export function createAuthVerifier(
  options: AuthVerifierOptions,
): TokenVerifier {
  const devVerifier = createDevOrMockVerifier();

  if (options.cognitoUserPoolId && options.cognitoRegion) {
    const cognitoVerifier = createCognitoVerifier({
      userPoolId: options.cognitoUserPoolId,
      region: options.cognitoRegion,
      clientId: options.cognitoClientId,
    });
    return async (token: string) => {
      // In non-production, allow local dev tokens
      if (process.env.NODE_ENV !== 'production') {
        try {
          return await devVerifier(token);
        } catch {}
      }
      return await cognitoVerifier(token);
    };
  }

  if (options.supabaseUrl) {
    const base = options.supabaseUrl.replace(/\/$/, '');
    const issuer = `${base}/auth/v1`;
    const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    const supabaseVerifier = async (token: string) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: options.supabaseAudience ?? 'authenticated',
      });
      if (typeof payload.sub !== 'string' || !UUID_REGEX.test(payload.sub)) {
        throw new Error('Invalid JWT subject');
      }
      return payload.sub;
    };
    return async (token: string) => {
      if (process.env.NODE_ENV !== 'production') {
        try {
          return await devVerifier(token);
        } catch {}
      }
      return await supabaseVerifier(token);
    };
  }

  return devVerifier;
}

// Backwards-compatible export
export function createSupabaseVerifier(
  supabaseUrl: string,
  audience = 'authenticated',
): TokenVerifier {
  return createAuthVerifier({ supabaseUrl, supabaseAudience: audience });
}
