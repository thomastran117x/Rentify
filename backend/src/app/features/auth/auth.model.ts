import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import { usernameSchema } from "@/features/profile/profile.model";
import { z } from "zod";

const UNSAFE_AUTH_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";
const UNSAFE_AUTH_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

function containsUnsafeAuthInput(value: string): boolean {
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

export const localSignupRequestSchema = z.object({
  username: authUsernameSchema,
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: strongPasswordSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  deviceId: optionalTrimmedString,
});

export const localAuthenticateRequestSchema = z.object({
  username: authUsernameSchema,
  password: z
    .string()
    .min(1, "Password is required.")
    .refine(
      (value) => !containsUnsafeAuthInput(value),
      UNSAFE_AUTH_INPUT_MESSAGE,
    ),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
  rememberMe: z.boolean().optional(),
  deviceId: optionalTrimmedString,
  totpCode: z.string().optional(),
});

export const oauthProviderSchema = z.enum(["google", "microsoft", "apple"]);

export const verifyEmailRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Verification code must be 6 digits."),
  deviceId: optionalTrimmedString,
});

export const resendVerificationEmailRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const unlockLocalLoginRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Unlock code must be 6 digits."),
});

export const resendUnlockLocalLoginRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const forgotPasswordRequestSchema = z.object({
  username: authUsernameSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const resendForgotPasswordRequestSchema = z.object({
  username: authUsernameSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const resetPasswordRequestSchema = z.object({
  username: authUsernameSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Reset code must be 6 digits."),
  newPassword: strongPasswordSchema,
  deviceId: optionalTrimmedString,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Current password is required.")
    .refine(
      (value) => !containsUnsafeAuthInput(value),
      UNSAFE_AUTH_INPUT_MESSAGE,
    ),
  newPassword: strongPasswordSchema,
});

export const setPasswordRequestSchema = z.object({
  newPassword: strongPasswordSchema,
});

export type LocalSignupRequestBody = z.infer<typeof localSignupRequestSchema>;

export type LocalAuthenticateRequestBody = z.infer<
  typeof localAuthenticateRequestSchema
>;

export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export type VerifyEmailRequestBody = z.infer<typeof verifyEmailRequestSchema>;

export type ResendVerificationEmailRequestBody = z.infer<
  typeof resendVerificationEmailRequestSchema
>;

export type UnlockLocalLoginRequestBody = z.infer<
  typeof unlockLocalLoginRequestSchema
>;

export type ResendUnlockLocalLoginRequestBody = z.infer<
  typeof resendUnlockLocalLoginRequestSchema
>;

export type ForgotPasswordRequestBody = z.infer<
  typeof forgotPasswordRequestSchema
>;

export type ResendForgotPasswordRequestBody = z.infer<
  typeof resendForgotPasswordRequestSchema
>;

export type ResetPasswordRequestBody = z.infer<
  typeof resetPasswordRequestSchema
>;

export type ChangePasswordRequestBody = z.infer<
  typeof changePasswordRequestSchema
>;

export type SetPasswordRequestBody = z.infer<typeof setPasswordRequestSchema>;

export interface LocalAuthenticateInput {
  client: ClientRequestContext;
  username: string;
  password: string;
  rememberMe?: boolean;
  deviceId?: string;
  totpCode?: string;
}

export interface LocalSignupInput {
  client: ClientRequestContext;
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  deviceId?: string;
}

export interface VerifyEmailInput {
  client: ClientRequestContext;
  email: string;
  code: string;
  deviceId?: string;
}

export interface ResendVerificationEmailInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
}

export interface UnlockLocalLoginInput {
  email: string;
  code: string;
}

export interface ResendUnlockLocalLoginInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
}

export interface AuthRequestContext {
  auth: AuthPrincipal;
  client: ClientRequestContext;
  refreshToken?: string;
}

export interface ForgotPasswordInput {
  client: ClientRequestContext;
  username: string;
  deviceId?: string;
}

export interface ResendForgotPasswordInput {
  client: ClientRequestContext;
  username: string;
  deviceId?: string;
}

export interface ResetPasswordInput {
  client: ClientRequestContext;
  username: string;
  code: string;
  newPassword: string;
  deviceId?: string;
}

export interface ChangePasswordInput {
  userId: string;
  client: ClientRequestContext;
  currentPassword: string;
  newPassword: string;
  deviceId?: string;
}

export interface SetPasswordInput {
  userId: string;
  client: ClientRequestContext;
  newPassword: string;
  deviceId?: string;
}

export interface CreateLocalUserInput {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface UserProfileRecord {
  id: string;
  userId: string;
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
  id: string;
  userId: string;
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
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: "primary_manager" | "manager" | "operator";
  createdAt: string;
  updatedAt: string;
}

export interface AuthActiveOrganizationSummary {
  id: string;
  name: string;
  role: "primary_manager" | "manager" | "operator";
}

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash?: string;
  tokenVersion: number;
  firstName?: string;
  lastName?: string;
  role: AppRole;
  emailVerified: boolean;
  profile: UserProfileRecord;
  oauthIdentities: OAuthIdentityRecord[];
  preferredOrganizationId?: string;
  organizationMemberships: AuthUserOrganizationMembershipRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserProfile {
  id: string;
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
  id: string;
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

export interface SignupVerificationPendingResult {
  verificationRequired: true;
  email: string;
  alreadyPending: boolean;
}

