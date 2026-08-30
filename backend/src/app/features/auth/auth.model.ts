import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import { usernameSchema } from "@/features/profile/profile.model";
import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

export const UNSAFE_AUTH_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";
const UNSAFE_AUTH_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

export function containsUnsafeAuthInput(value: string): boolean {
  return UNSAFE_AUTH_INPUT_PATTERN.test(value);
}

export const safeTrimmedString = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !containsUnsafeAuthInput(value),
    UNSAFE_AUTH_INPUT_MESSAGE,
  );

export const requiredSafeTrimmedString = (requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine(
      (value) => !containsUnsafeAuthInput(value),
      UNSAFE_AUTH_INPUT_MESSAGE,
    );

export const optionalTrimmedString = safeTrimmedString.optional();
export const appRoleSchema = z.enum(["user", "owner", "moderator", "admin"]);
export type AppRole = z.infer<typeof appRoleSchema>;
export const DEFAULT_APP_ROLE: AppRole = "user";
const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.";

export function normalizeAppRole(role: string | null | undefined): AppRole {
  const parsedRole = appRoleSchema.safeParse(role ?? DEFAULT_APP_ROLE);

  if (parsedRole.success) {
    return parsedRole.data;
  }

  throw new Error(`Unsupported application role: ${role ?? "undefined"}.`);
}

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export const strongPasswordSchema = z
  .string()
  .min(8, STRONG_PASSWORD_MESSAGE)
  .refine((value) => !containsUnsafeAuthInput(value), UNSAFE_AUTH_INPUT_MESSAGE)
  .refine(isStrongPassword, STRONG_PASSWORD_MESSAGE);

export const authUsernameSchema = usernameSchema.transform((value) =>
  value.trim().toLowerCase(),
);

export const oauthProviderSchema = z.enum(["google", "microsoft", "apple"]);

export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export interface AuthRequestContext {
  auth: AuthPrincipal;
  client: ClientRequestContext;
  refreshToken?: string;
}

export interface CreateLocalUserInput {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface UserProfileRecord {
  id: Uuid;
  userId: Uuid;
  username: string;
  phoneNumber?: string;
  avatarUrl?: string;
  avatarBlobName?: string;
  isPrivate: boolean;
  recommendationPersonalizationEnabled: boolean;
  trustworthinessScore: number;
  rentPostingsCount: number;
  availableRentPostingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthIdentityRecord {
  id: Uuid;
  userId: Uuid;
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail?: string;
  emailVerified: boolean;
  displayName?: string;
  linkedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserOrganizationMembershipRecord {
  membershipId: Uuid;
  organizationId: Uuid;
  organizationName: string;
  role: "primary_manager" | "manager" | "operator";
  createdAt: string;
  updatedAt: string;
}

export interface AuthActiveOrganizationSummary {
  id: Uuid;
  name: string;
  role: "primary_manager" | "manager" | "operator";
}

export interface AuthUserRecord {
  id: Uuid;
  email: string;
  passwordHash?: string;
  tokenVersion: number;
  firstName?: string;
  lastName?: string;
  role: AppRole;
  emailVerified: boolean;
  profile: UserProfileRecord;
  oauthIdentities: OAuthIdentityRecord[];
  preferredOrganizationId?: Uuid;
  organizationMemberships: AuthUserOrganizationMembershipRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserProfile {
  id: Uuid;
  email: string;
  firstName?: string;
  lastName?: string;
  username: string;
  phoneNumber?: string;
  avatarUrl?: string;
  isPrivate: boolean;
  recommendationPersonalizationEnabled: boolean;
  trustworthinessScore: number;
  rentPostingsCount: number;
  availableRentPostingsCount: number;
  role: AppRole;
  emailVerified: boolean;
  activeOrganization?: AuthActiveOrganizationSummary;
  organizationMembershipCount: number;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresInSeconds: number;
  device: {
    deviceId?: string;
    known: boolean;
    knownByIp: boolean;
  };
  user: AuthUserProfile;
  /**
   * Set only when this session was created by a first-time OAuth sign-in, so
   * clients can surface the auto-generated username onboarding flow. Absent for
   * every returning sign-in and every local flow.
   */
  isNewUser?: boolean;
}

export interface AuthResponseUser {
  id: Uuid;
  email: string;
  username: string;
  avatarUrl?: string;
  role: AppRole;
  activeOrganization?: AuthActiveOrganizationSummary;
  organizationMembershipCount: number;
}

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
   * True only for the response of a first-time OAuth sign-in that just created
   * the account. Clients use it to launch the generated-username onboarding.
   */
  isNewUser?: boolean;
}
