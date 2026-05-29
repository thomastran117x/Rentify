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

export interface ApiResponseMeta {
  requestId: string;
  pagination?: unknown;
  [key: string]: unknown;
}

export interface ApiErrorPayload<TDetails = unknown> {
  code: string;
  details?: TDetails;
}

export interface ApiResponse<TData> {
  success: true;
  message: string;
  data: TData;
  error: null;
  meta: ApiResponseMeta;
}

export interface ApiErrorResponse<TDetails = unknown> {
  success: false;
  message: string;
  data: null;
  error: ApiErrorPayload<TDetails>;
  meta: ApiResponseMeta;
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type StoredAuthSession = AuthResponseBody;
