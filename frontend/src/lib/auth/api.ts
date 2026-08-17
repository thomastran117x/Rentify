import {
  authenticatedJson,
  buildPathWithQuery,
  hasRefreshCookieHint,
  optionalAuthJson,
  publicJson,
  refreshStoredSession,
} from "@/lib/api/client";
import { getDeviceId } from "@/lib/auth/device";
import type {
  AuthEmailAcceptedResult,
  AuthResponseBody,
  ForgotPasswordAcceptedResult,
  KnownDevicesResult,
  LinkedOAuthProvidersResult,
  OAuthProvider,
  PersonalAccessTokenListResult,
  CreatePersonalAccessTokenResult,
  RevokePersonalAccessTokenResult,
  SessionVerificationResult,
  SignupVerificationPendingResult,
  UsernameAvailabilityResult,
} from "@/lib/auth/types";
import { personalAccessTokensApi } from "@/lib/personal-access-tokens/api";

interface LoginInput {
  username: string;
  password: string;
  captchaToken: string;
  rememberMe?: boolean;
  deviceId?: string;
}
interface SignupInput {
  firstName: string;
  lastName: string;
  username: string;
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
  username: string;
  captchaToken: string;
}

interface ResendForgotPasswordInput {
  username: string;
  captchaToken: string;
}

interface ForgotUsernameInput {
  email: string;
  captchaToken: string;
}

interface ResetPasswordInput {
  username: string;
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
  rememberMe?: boolean;
  firstName?: string;
  lastName?: string;
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

export function postAuthenticatedJson<TResponse, TBody extends object = object>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  return authenticatedJson<TResponse, TBody>("POST", path, body);
}

export function getAuthenticatedJson<TResponse>(
  path: string,
): Promise<TResponse> {
  return authenticatedJson<TResponse>("GET", path);
}

export function patchAuthenticatedJson<
  TResponse,
  TBody extends object = object,
>(path: string, body: TBody): Promise<TResponse> {
  return authenticatedJson<TResponse, TBody>("PATCH", path, body);
}

export function putAuthenticatedJson<TResponse, TBody extends object = object>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  return authenticatedJson<TResponse, TBody>("PUT", path, body);
}

export function deleteAuthenticatedJson<TResponse>(
  path: string,
): Promise<TResponse> {
  return authenticatedJson<TResponse>("DELETE", path);
}

export function getOptionalAuthJson<TResponse>(
  path: string,
): Promise<TResponse> {
  return optionalAuthJson<TResponse>("GET", path);
}

export const authApi = {
  hasRefreshCookieHint(): boolean {
    return hasRefreshCookieHint();
  },
  login(input: LoginInput): Promise<AuthResponseBody> {
    return publicJson<AuthResponseBody, LoginInput>(
      "POST",
      "/auth/local/login",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  logout(): Promise<{ loggedOut: true }> {
    return postAuthenticatedJson<{ loggedOut: true }, Record<string, never>>(
      "/auth/logout",
      {},
    );
  },
  refresh(): Promise<AuthResponseBody | null> {
    return refreshStoredSession();
  },
  verifyLocalSession(): Promise<SessionVerificationResult> {
    return postAuthenticatedJson<
      SessionVerificationResult,
      Record<string, never>
    >("/auth/local/verify", {});
  },
  authenticateWithGoogle(
    input: OAuthAuthenticateInput,
  ): Promise<AuthResponseBody> {
    return publicJson<AuthResponseBody, OAuthAuthenticateInput>(
      "POST",
      "/auth/oauth/google",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  authenticateWithMicrosoft(
    input: OAuthAuthenticateInput,
  ): Promise<AuthResponseBody> {
    return publicJson<AuthResponseBody, OAuthAuthenticateInput>(
      "POST",
      "/auth/oauth/microsoft",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  authenticateWithApple(
    input: OAuthAuthenticateInput,
  ): Promise<AuthResponseBody> {
    return publicJson<AuthResponseBody, OAuthAuthenticateInput>(
      "POST",
      "/auth/oauth/apple",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  linkOAuthProvider(
    provider: OAuthProvider,
    input: OAuthAuthenticateInput,
  ): Promise<LinkedOAuthProvidersResult> {
    return postAuthenticatedJson<
      LinkedOAuthProvidersResult,
      OAuthAuthenticateInput
    >(`/auth/oauth/${provider}/link`, {
      ...input,
      deviceId: input.deviceId ?? getDeviceId(),
    });
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
    return publicJson<SignupVerificationPendingResult, SignupInput>(
      "POST",
      "/auth/local/signup",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  verifyEmail(input: VerifyEmailInput): Promise<AuthResponseBody> {
    return publicJson<AuthResponseBody, VerifyEmailInput>(
      "POST",
      "/auth/local/email/verify",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  resendVerificationEmail(
    input: ResendVerificationEmailInput,
  ): Promise<AuthEmailAcceptedResult> {
    return publicJson<AuthEmailAcceptedResult, ResendVerificationEmailInput>(
      "POST",
      "/auth/local/email/resend",
      input,
    );
  },
  forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<ForgotPasswordAcceptedResult> {
    return publicJson<ForgotPasswordAcceptedResult, ForgotPasswordInput>(
      "POST",
      "/auth/local/password/forgot",
      input,
    );
  },
  resendForgotPassword(
    input: ResendForgotPasswordInput,
  ): Promise<ForgotPasswordAcceptedResult> {
    return publicJson<ForgotPasswordAcceptedResult, ResendForgotPasswordInput>(
      "POST",
      "/auth/local/password/forgot/resend",
      input,
    );
  },
  forgotUsername(
    input: ForgotUsernameInput,
  ): Promise<ForgotPasswordAcceptedResult> {
    return publicJson<ForgotPasswordAcceptedResult, ForgotUsernameInput>(
      "POST",
      "/auth/local/username/forgot",
      input,
    );
  },
  /**
   * Sent with optional auth: when the caller is signed in, the backend exempts
   * their own current username so settings does not report it as taken.
   */
  checkUsernameAvailability(
    username: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<UsernameAvailabilityResult> {
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    return optionalAuthJson<UsernameAvailabilityResult>(
      "GET",
      buildPathWithQuery("/auth/username/available", { username }),
      undefined,
      undefined,
      options.signal,
    );
  },
  resetPassword(input: ResetPasswordInput): Promise<AuthResponseBody> {
    return publicJson<AuthResponseBody, ResetPasswordInput>(
      "POST",
      "/auth/local/password/reset",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  unlockLocalLogin(
    input: UnlockLocalLoginInput,
  ): Promise<{ unlocked: true; email: string }> {
    return publicJson<
      { unlocked: true; email: string },
      UnlockLocalLoginInput & { deviceId?: string }
    >("POST", "/auth/local/unlock", {
      ...input,
      deviceId: getDeviceId(),
    });
  },
  resendUnlockLocalLogin(
    input: ResendUnlockLocalLoginInput,
  ): Promise<AuthEmailAcceptedResult> {
    return publicJson<AuthEmailAcceptedResult, ResendUnlockLocalLoginInput>(
      "POST",
      "/auth/local/unlock/resend",
      input,
    );
  },
  changePassword(input: ChangePasswordInput): Promise<AuthResponseBody> {
    return postAuthenticatedJson<AuthResponseBody, ChangePasswordInput>(
      "/auth/local/password/change",
      {
        ...input,
        deviceId: input.deviceId ?? getDeviceId(),
      },
    );
  },
  verifyDevice(): Promise<{ ok: true }> {
    return postAuthenticatedJson<{ ok: true }, Record<string, never>>(
      "/auth/device/verify",
      {},
    );
  },
  listKnownDevices(): Promise<KnownDevicesResult> {
    return getAuthenticatedJson<KnownDevicesResult>("/auth/devices");
  },
  removeKnownDevice(deviceId: string): Promise<{ ok: true }> {
    return authenticatedJson<{ ok: true }, { deviceId: string }>(
      "DELETE",
      "/auth/devices/remove",
      { deviceId },
    );
  },
  listPersonalAccessTokens(): Promise<PersonalAccessTokenListResult> {
    return personalAccessTokensApi.list();
  },
  createPersonalAccessToken(
    input: CreatePersonalAccessTokenInput,
  ): Promise<CreatePersonalAccessTokenResult> {
    return personalAccessTokensApi.create(input);
  },
  revokePersonalAccessToken(
    tokenId: string,
  ): Promise<RevokePersonalAccessTokenResult> {
    return personalAccessTokensApi.revoke(tokenId);
  },
};
