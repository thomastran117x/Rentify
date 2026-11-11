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
    /**
     * Set when this sign-in skipped, or just remembered the device for, the
     * second factor: when that ends.
     */
    trustedUntil?: string;
  };
  user: AuthResponseUser;
  /**
   * Present and true only when a first-time OAuth sign-in just created this
   * account. Drives the generated-username onboarding welcome modal. Absent for
   * returning sign-ins and all local flows.
   */
  isNewUser?: boolean;
  /** How many recovery codes are left, after a sign-in that spent one. */
  recoveryCodesRemaining?: number;
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

/** What an OAuth sign-in is for; the backend binds its state to it. */
export type OAuthFlowIntent = "login" | "signup" | "link";

/**
 * The server-issued half of one OAuth sign-in. `state` and `nonce` go into
 * the provider's authorize request; `tokenDelivery` says whether the callback
 * sends the authorization code or the provider's ID token. `codeChallenge` is
 * present only when the backend redeems the code, and its verifier never
 * reaches the browser.
 */
export interface OAuthFlowStart {
  state: string;
  nonce: string;
  codeChallenge?: string;
  tokenDelivery: "code" | "id_token";
  expiresInSeconds: number;
}

/**
 * The second factors a sign-in can be finished with, strongest first, and the
 * only list of them. A factor this client does not list is dropped from a
 * challenge.
 */
export const LOGIN_MFA_FACTORS = ["passkey", "totp", "recovery_code"] as const;

export type LoginMfaFactor = (typeof LOGIN_MFA_FACTORS)[number];

/**
 * The challenge a correct password or provider sign-in carries, instead of a
 * session, when the account has a passkey or an authenticator app. The token is the only
 * thing kept between the two steps; the password is never sent again.
 */
export interface LoginMfaChallenge {
  mfaRequired: true;
  mfaChallengeToken: string;
  availableFactors: LoginMfaFactor[];
  expiresInSeconds: number;
  /**
   * How long "Remember this device" lasts. Absent from a backend that cannot
   * remember devices, and then the option is not offered.
   */
  rememberDeviceDays?: number;
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
    ...(isPositiveInteger(details.rememberDeviceDays)
      ? { rememberDeviceDays: details.rememberDeviceDays }
      : {}),
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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

export type PasswordIssueCode =
  | "too_short"
  | "too_long"
  | "unsafe_input"
  | "common"
  | "contains_personal_info"
  | "breached";

export interface PasswordIssue {
  code: PasswordIssueCode;
  message: string;
}

/** `POST /auth/password/check`: what the server thinks of a new password. */
export interface PasswordCheckResult {
  /** True when submitting it would be accepted. Warnings do not count. */
  acceptable: boolean;
  issues: PasswordIssue[];
  /** Advice that does not block the password, e.g. a breach in `warn` mode. */
  warnings: PasswordIssue[];
}

export interface PasswordCheckInput {
  password: string;
  /** Ignored when signed in: the server uses the account's own details. */
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface UsernameAvailabilityResult {
  /** The normalized (trimmed, lowercased) username that was checked. */
  username: string;
  available: boolean;
  reason: "taken" | "inappropriate" | null;
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
  /** Registered with the device cookie, so a sign-in from it is recognised. */
  bound?: boolean;
  /** "Remember this device" is in force: sign-ins here skip the code. */
  trusted?: boolean;
  trustedUntil?: string;
  [key: string]: unknown;
}

export interface RevokeDeviceTrustResult {
  revoked: boolean;
  deviceId: string;
}

export interface KnownDevicesResult {
  devices: KnownDeviceRecord[];
}

export interface AuthSessionSummary {
  id: string;
  deviceLabel: string;
  platform: string | null;
  browser: string | null;
  os: string | null;
  firstIpAddress: string | null;
  lastIpAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  rememberMe: boolean;
  current: boolean;
}

export interface AuthSessionListResult {
  sessions: AuthSessionSummary[];
}

export interface RevokeAuthSessionResult {
  revoked: true;
  id: string;
  current: boolean;
}

export type RevokeAuthSessionsScope = "others" | "all";

export interface RevokeAuthSessionsResult {
  scope: RevokeAuthSessionsScope;
  revokedSessionCount: number;
  revokedPersonalAccessTokenCount: number;
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
