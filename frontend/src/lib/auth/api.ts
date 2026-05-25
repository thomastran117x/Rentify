import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { publicEnv } from "@/lib/env";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "@/lib/auth/storage";
import {
  type AuthEmailAcceptedResult,
  type AuthResponseBody,
  type ForgotPasswordAcceptedResult,
  type LinkedOAuthProvidersResult,
  type OAuthProvider,
  type PersonalAccessTokenListResult,
  type CreatePersonalAccessTokenResult,
  type RevokePersonalAccessTokenResult,
  type SignupVerificationPendingResult,
} from "@/lib/auth/types";

interface LoginInput {
  email: string;
  password: string;
  captchaToken: string;
  deviceId?: string;
}

interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  captchaToken: string;
  deviceId?: string;
}

interface VerifyEmailInput {
  email: string;
  code: string;
  deviceId?: string;
}

interface ResendVerificationEmailInput {
  email: string;
  captchaToken: string;
}

interface ForgotPasswordInput {
  email: string;
  captchaToken: string;
}

interface ResendForgotPasswordInput {
  email: string;
  captchaToken: string;
}

interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
  deviceId?: string;
}

interface UnlockLocalLoginInput {
  email: string;
  code: string;
}

interface ResendUnlockLocalLoginInput {
  email: string;
  captchaToken: string;
}

interface OAuthAuthenticateInput {
  nonce: string;
  code?: string;
  codeVerifier?: string;
  idToken?: string;
  deviceId?: string;
}

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  deviceId?: string;
}

interface CreatePersonalAccessTokenInput {
  name: string;
  expiresInDays: number;
  scopes: Array<"mcp:read" | "mcp:write">;
}

let refreshSessionPromise: Promise<AuthResponseBody | null> | null = null;
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function readCsrfToken(): string | undefined {
  const token = readCookie(CSRF_COOKIE_NAME);
  return token ? decodeURIComponent(token) : undefined;
}

function hasRefreshCookieHint(): boolean {
  return Boolean(readCsrfToken());
}

async function postJson<TResponse, TBody extends object = object>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body),
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
}

async function postAuthenticatedJson<TResponse, TBody extends object = object>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  return authenticatedJsonWithRetry(path, "POST", body, true);
}

async function getAuthenticatedJson<TResponse>(
  path: string,
): Promise<TResponse> {
  return authenticatedJsonWithRetry<TResponse>(path, "GET", undefined, true);
}

async function deleteAuthenticatedJson<TResponse>(
  path: string,
): Promise<TResponse> {
  return authenticatedJsonWithRetry<TResponse>(path, "DELETE", undefined, true);
}

async function authenticatedJsonWithRetry<
  TResponse,
  TBody extends object = object,
>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body: TBody | undefined,
  allowRefreshRetry: boolean,
): Promise<TResponse> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const session = readStoredSession();
  const csrfToken = readCsrfToken();
  const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      accept: "application/json",
      ...(session?.accessToken
        ? { authorization: `Bearer ${session.accessToken}` }
        : {}),
      ...(csrfToken && method !== "GET"
        ? { [CSRF_HEADER_NAME]: csrfToken }
        : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    },
    credentials: "include",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await readJson(response);

  if (response.status === 401 && allowRefreshRetry) {
    const refreshedSession = await refreshStoredSession();

    if (refreshedSession) {
      return authenticatedJsonWithRetry(path, method, body, false);
    }
  }

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
}

async function refreshStoredSession(): Promise<AuthResponseBody | null> {
  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = (async () => {
    const session = readStoredSession();
    const deviceId = getDeviceId();
    const devicePlatform = getDevicePlatform();
    const csrfToken = readCsrfToken();
    const response = await fetch(`${publicEnv.apiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
        ...(deviceId ? { "x-device-id": deviceId } : {}),
        ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        ...(session?.refreshToken
          ? { refreshToken: session.refreshToken }
          : {}),
      }),
    });

    const payload = await readJson(response);

    if (!response.ok) {
      clearStoredSession();
      return null;
    }

    const nextSession = unwrapApiResponse<AuthResponseBody>(payload);
    writeStoredSession(nextSession);
    return nextSession;
  })();

  try {
    return await refreshSessionPromise;
  } finally {
    refreshSessionPromise = null;
  }
}

export const authApi = {
  hasRefreshCookieHint(): boolean {
    return hasRefreshCookieHint();
  },
  login(input: LoginInput): Promise<AuthResponseBody> {
    return postJson<AuthResponseBody>("/auth/local/login", {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
  },
  logout(): Promise<{ loggedOut: true }> {
    return postAuthenticatedJson<{ loggedOut: true }>("/auth/logout", {});
  },
  refresh(): Promise<AuthResponseBody | null> {
    return refreshStoredSession();
  },
  authenticateWithGoogle(
    input: OAuthAuthenticateInput,
  ): Promise<AuthResponseBody> {
    return postJson<AuthResponseBody>("/auth/oauth/google", {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
  },
  authenticateWithMicrosoft(
    input: OAuthAuthenticateInput,
  ): Promise<AuthResponseBody> {
    return postJson<AuthResponseBody>("/auth/oauth/microsoft", {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
  },
  linkOAuthProvider(
    provider: Exclude<OAuthProvider, "apple">,
    input: OAuthAuthenticateInput,
  ): Promise<LinkedOAuthProvidersResult> {
    return postAuthenticatedJson<LinkedOAuthProvidersResult>(
      `/auth/oauth/${provider}/link`,
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  linkedOAuthProviders(): Promise<LinkedOAuthProvidersResult> {
    return getAuthenticatedJson<LinkedOAuthProvidersResult>(
      "/auth/oauth/providers",
    );
  },
  unlinkOAuthProvider(
    provider: OAuthProvider,
  ): Promise<LinkedOAuthProvidersResult> {
    return deleteAuthenticatedJson<LinkedOAuthProvidersResult>(
      `/auth/oauth/${provider}`,
    );
  },
  signup(input: SignupInput): Promise<SignupVerificationPendingResult> {
    return postJson<SignupVerificationPendingResult>("/auth/local/signup", {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
  },
  verifyEmail(input: VerifyEmailInput): Promise<AuthResponseBody> {
    return postJson<AuthResponseBody>("/auth/local/email/verify", {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
  },
  resendVerificationEmail(
    input: ResendVerificationEmailInput,
  ): Promise<AuthEmailAcceptedResult> {
    return postJson<AuthEmailAcceptedResult>("/auth/local/email/resend", input);
  },
  forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<ForgotPasswordAcceptedResult> {
    return postJson<ForgotPasswordAcceptedResult>(
      "/auth/local/password/forgot",
      input,
    );
  },
  resendForgotPassword(
    input: ResendForgotPasswordInput,
  ): Promise<ForgotPasswordAcceptedResult> {
    return postJson<ForgotPasswordAcceptedResult>(
      "/auth/local/password/forgot/resend",
      input,
    );
  },
  resetPassword(input: ResetPasswordInput): Promise<AuthResponseBody> {
    return postJson<AuthResponseBody>("/auth/local/password/reset", {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
  },
  unlockLocalLogin(
    input: UnlockLocalLoginInput,
  ): Promise<{ unlocked: true; email: string }> {
    return postJson<{ unlocked: true; email: string }>("/auth/local/unlock", {
      ...input,
      deviceId: getDeviceId(),
    });
  },
  resendUnlockLocalLogin(
    input: ResendUnlockLocalLoginInput,
  ): Promise<AuthEmailAcceptedResult> {
    return postJson<AuthEmailAcceptedResult>(
      "/auth/local/unlock/resend",
      input,
    );
  },
  changePassword(input: ChangePasswordInput): Promise<AuthResponseBody> {
    return postAuthenticatedJson<AuthResponseBody>(
      "/auth/local/password/change",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  listPersonalAccessTokens(): Promise<PersonalAccessTokenListResult> {
    return getAuthenticatedJson<PersonalAccessTokenListResult>(
      "/auth/personal-access-tokens",
    );
  },
  createPersonalAccessToken(
    input: CreatePersonalAccessTokenInput,
  ): Promise<CreatePersonalAccessTokenResult> {
    return postAuthenticatedJson<CreatePersonalAccessTokenResult>(
      "/auth/personal-access-tokens",
      {
        name: input.name,
        scopes: input.scopes,
        expiresInDays: input.expiresInDays,
      },
    );
  },
  revokePersonalAccessToken(
    tokenId: string,
  ): Promise<RevokePersonalAccessTokenResult> {
    return deleteAuthenticatedJson<RevokePersonalAccessTokenResult>(
      `/auth/personal-access-tokens/${tokenId}`,
    );
  },
};
