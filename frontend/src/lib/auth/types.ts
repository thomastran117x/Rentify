import { ApiClientError } from "@/lib/api/types";
import type { ImageVariants } from "@/lib/media/api";

export type {
  ApiRequestContext,
  ApiErrorPayload,
  ApiErrorResponse,
  ApiResponse,
  ApiResponseMeta,
} from "@/lib/api/types";
export {
  ApiClientError,
  ApiError,
  ApiNetworkError,
  ApiProtocolError,
  ApiRateLimitError,
  ApiServerError,
  isApiClientError,
  isApiNetworkError,
  isApiProtocolError,
  isApiRateLimitError,
  isApiServerError,
} from "@/lib/api/types";

export interface ActiveOrganizationSummary {
  id: string;
  name: string;
  role: "primary_manager" | "manager" | "operator";
}

export interface AuthResponseUser {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
  avatarVariants?: ImageVariants | null;
  role: "user" | "owner" | "moderator" | "admin";
  activeOrganization?: ActiveOrganizationSummary;
  organizationMembershipCount?: number;
}

export type OAuthProvider = "google" | "microsoft" | "apple";

export interface AuthResponseBody {
  accessToken: string;
  refreshToken?: string;
  device: {
    deviceId?: string;
    known: boolean;
    knownByIp: boolean;
  };
  user: AuthResponseUser;
  /**
   * Present and true only when a first-time OAuth sign-in just created this
   * account. Drives the generated-username onboarding welcome modal. Absent for
   * returning sign-ins and all local flows.
   */
  isNewUser?: boolean;
}

export interface SignupVerificationPendingResult {
  verificationRequired: true;
  email: string;
  alreadyPending: boolean;
}

export interface OAuthSignupRequiredResult {
  signupRequired: true;
  signupToken: string;
  expiresInSeconds: number;
}

/**
 * The second factors a sign-in can be finished with, and the only list of
 * them. Recovery codes and passkeys join it without changing the challenge's
 * shape; a factor this client does not list is dropped from a challenge.
 */
export const LOGIN_MFA_FACTORS = ["totp"] as const;

export type LoginMfaFactor = (typeof LOGIN_MFA_FACTORS)[number];

/**
 * The challenge a correct password or provider sign-in carries, instead of a
 * session, when the account has an authenticator app. The token is the only
 * thing kept between the two steps; the password is never sent again.
 */
export interface LoginMfaChallenge {
  mfaRequired: true;
  mfaChallengeToken: string;
  availableFactors: LoginMfaFactor[];
  expiresInSeconds: number;
}

export type OAuthAuthenticateResult =
  | AuthResponseBody
  | OAuthSignupRequiredResult;

/**
 * The first step refuses an account that needs an authenticator code with
 * `401` and `details.mfaRequired`, the contract older clients rely on. The
 * challenge for `POST /auth/login/mfa` is in the same details; a refusal
 * without one (an older backend) is not a challenge this client can finish.
 */
export function readLoginMfaChallenge(
  error: unknown,
): LoginMfaChallenge | null {
  if (!(error instanceof ApiClientError) || error.status !== 401) {
    return null;
  }

  const details = error.details as Partial<LoginMfaChallenge> | undefined;

  if (
    details?.mfaRequired !== true ||
    typeof details.mfaChallengeToken !== "string" ||
    details.mfaChallengeToken.length === 0 ||
    !Array.isArray(details.availableFactors) ||
    typeof details.expiresInSeconds !== "number"
  ) {
    return null;
  }

  return {
    mfaRequired: true,
    mfaChallengeToken: details.mfaChallengeToken,
    availableFactors: details.availableFactors,
    expiresInSeconds: details.expiresInSeconds,
  };
}

export function isOAuthSignupRequired(
  result: OAuthAuthenticateResult,
): result is OAuthSignupRequiredResult {
  return "signupRequired" in result;
}

export interface UsernameSuggestionsResult {
  suggestions: string[];
}

export interface ForgotPasswordAcceptedResult {
  accepted: true;
}

export type AuthEmailAcceptedResult = ForgotPasswordAcceptedResult;

export interface UsernameAvailabilityResult {
  /** The normalized (trimmed, lowercased) username that was checked. */
  username: string;
  available: boolean;
  reason: "taken" | "inappropriate" | null;
}

export interface EmailAvailabilityResult {
  /** The normalized (trimmed, lowercased) email that was checked. */
  email: string;
  available: boolean;
  /**
   * `pending-verification` still means available. Signup accepts an address
   * whose verification is unfinished — that is how someone who abandoned a
   * signup comes back and completes it — so the form reports it rather than
   * blocking on it.
   */
  reason: "taken" | "pending-verification" | null;
}

export interface LinkedOAuthProvidersResult {
  hasPassword: boolean;
  providers: Array<{
    id: string;
    provider: OAuthProvider;
    providerEmail?: string;
    emailVerified: boolean;
    displayName?: string;
    linkedAt: string;
  }>;
}

export interface SessionVerificationResult {
  verified: boolean;
  auth?: {
    userId: string;
    deviceId?: string;
    role: AuthResponseUser["role"];
  };
  client?: {
    ip?: string;
    device?: {
      id?: string;
      type?: string;
      isMobile?: boolean;
      userAgent?: string;
      platform?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface KnownDeviceRecord {
  id: string;
  label?: string;
  deviceId: string;
  type?: string;
  platform?: string;
  lastIpAddress?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  knownByIp?: boolean;
  current?: boolean;
  [key: string]: unknown;
}

export interface KnownDevicesResult {
  devices: KnownDeviceRecord[];
}

export type PersonalAccessTokenScope = "mcp:read" | "mcp:write";

export interface PersonalAccessTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: PersonalAccessTokenScope[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalAccessTokenListResult {
  tokens: PersonalAccessTokenSummary[];
}

export interface CreatePersonalAccessTokenResult
  extends PersonalAccessTokenSummary {
  token: string;
}

export interface RevokePersonalAccessTokenResult {
  revoked: true;
  tokenId: string;
}

export type StoredAuthSession = AuthResponseBody;
