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

export interface ForgotPasswordAcceptedResult {
  accepted: true;
}

export type AuthEmailAcceptedResult = ForgotPasswordAcceptedResult;

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
