import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  GlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const region = process.env.NEXT_PUBLIC_AWS_REGION ?? 'ap-south-1';

const cognitoClient = clientId
  ? new CognitoIdentityProviderClient({ region })
  : null;

const STORAGE_KEY_TOKEN = 'webops_cognito_access_token';
const STORAGE_KEY_ID_TOKEN = 'webops_cognito_id_token';
const STORAGE_KEY_REFRESH = 'webops_cognito_refresh_token';
const STORAGE_KEY_USER = 'webops_user_email';

export interface AuthSession {
  accessToken: string;
  idToken?: string | undefined;
  email?: string | undefined;
}

export function isCognitoConfigured(): boolean {
  return Boolean(clientId && userPoolId);
}

export function getStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (!token) return null;
  return {
    accessToken: token,
    idToken: localStorage.getItem(STORAGE_KEY_ID_TOKEN) ?? undefined,
    email: localStorage.getItem(STORAGE_KEY_USER) ?? undefined,
  };
}

export function setStoredSession(
  accessToken: string,
  idToken?: string | undefined,
  refreshToken?: string | undefined,
  email?: string | undefined,
): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_TOKEN, accessToken);
  if (idToken) localStorage.setItem(STORAGE_KEY_ID_TOKEN, idToken);
  if (refreshToken) localStorage.setItem(STORAGE_KEY_REFRESH, refreshToken);
  if (email) localStorage.setItem(STORAGE_KEY_USER, email);
}

export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_ID_TOKEN);
  localStorage.removeItem(STORAGE_KEY_REFRESH);
  localStorage.removeItem(STORAGE_KEY_USER);
}

/**
 * Sign in user using AWS Cognito USER_PASSWORD_AUTH flow.
 */
export async function cognitoSignIn(
  email: string,
  pass: string,
): Promise<AuthSession> {
  if (!cognitoClient || !clientId) {
    // Development local fallback session (standard v4 UUID)
    const devToken = 'a0000000-0000-4000-8000-000000000001';
    setStoredSession(devToken, devToken, undefined, email);
    return { accessToken: devToken, email };
  }

  const command = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: pass,
    },
  });

  const response = await cognitoClient.send(command);
  const result = response.AuthenticationResult;

  if (!result?.AccessToken) {
    throw new Error('Authentication challenge or missing token');
  }

  setStoredSession(
    result.AccessToken,
    result.IdToken,
    result.RefreshToken,
    email,
  );

  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    email,
  };
}

/**
 * Sign up a new user with email and password in Amazon Cognito User Pool.
 */
export async function cognitoSignUp(
  email: string,
  pass: string,
): Promise<{ userConfirmed: boolean; userSub?: string | undefined }> {
  if (!cognitoClient || !clientId) {
    return { userConfirmed: true, userSub: 'dev-user' };
  }

  const command = new SignUpCommand({
    ClientId: clientId,
    Username: email,
    Password: pass,
    UserAttributes: [{ Name: 'email', Value: email }],
  });

  const response = await cognitoClient.send(command);
  return {
    userConfirmed: Boolean(response.UserConfirmed),
    userSub: response.UserSub,
  };
}

/**
 * Confirm user signup with email verification code.
 */
export async function cognitoConfirmSignUp(
  email: string,
  code: string,
): Promise<void> {
  if (!cognitoClient || !clientId) return;

  const command = new ConfirmSignUpCommand({
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
  });

  await cognitoClient.send(command);
}

/**
 * Sign out current user.
 */
export async function cognitoSignOut(): Promise<void> {
  const session = getStoredSession();
  if (cognitoClient && session?.accessToken) {
    try {
      await cognitoClient.send(
        new GlobalSignOutCommand({ AccessToken: session.accessToken }),
      );
    } catch {}
  }
  clearStoredSession();
}
