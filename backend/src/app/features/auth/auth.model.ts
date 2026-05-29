import type { ClientRequestContext } from "@/configuration/http/bindings";
import { z } from "zod";

const UNSAFE_AUTH_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";
const UNSAFE_AUTH_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

function containsUnsafeAuthInput(value: string): boolean {
  return UNSAFE_AUTH_INPUT_PATTERN.test(value);
}

const safeTrimmedString = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !containsUnsafeAuthInput(value),
    UNSAFE_AUTH_INPUT_MESSAGE,
  );

const requiredSafeTrimmedString = (requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine(
      (value) => !containsUnsafeAuthInput(value),
      UNSAFE_AUTH_INPUT_MESSAGE,
    );

const optionalTrimmedString = safeTrimmedString.optional();
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

export const localSignupRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: strongPasswordSchema,
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  deviceId: optionalTrimmedString,
});

export const localAuthenticateRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
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
});

export const oauthAuthenticateRequestSchema = z
  .object({
    code: optionalTrimmedString,
    codeVerifier: optionalTrimmedString,
    idToken: optionalTrimmedString,
    nonce: requiredSafeTrimmedString("Nonce is required."),
    rememberMe: z.boolean().optional(),
    deviceId: optionalTrimmedString,
    firstName: optionalTrimmedString,
    lastName: optionalTrimmedString,
  })
  .superRefine((input, context) => {
    if (input.idToken) {
      return;
    }

    if (!input.code) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorization code is required.",
        path: ["code"],
      });
    }

    if (!input.codeVerifier) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Code verifier is required.",
        path: ["codeVerifier"],
      });
    }
  });

export const oauthProviderSchema = z.enum(["google", "microsoft", "apple"]);

export const unlinkOAuthProviderRequestSchema = z.object({
  provider: oauthProviderSchema,
});

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

export const refreshRequestSchema = z.object({
  refreshToken: optionalTrimmedString,
});

export const forgotPasswordRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const resendForgotPasswordRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  captchaToken: requiredSafeTrimmedString("Captcha token is required."),
});

export const resetPasswordRequestSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
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

export const removeKnownDeviceRequestSchema = z.object({
  deviceId: z.string().trim().min(1, "Device ID is required."),
});

export type LocalSignupRequestBody = z.infer<typeof localSignupRequestSchema>;

export type LocalAuthenticateRequestBody = z.infer<
  typeof localAuthenticateRequestSchema
>;

export type OAuthAuthenticateRequestBody = z.infer<
  typeof oauthAuthenticateRequestSchema
>;

export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export type UnlinkOAuthProviderRequestBody = z.infer<
  typeof unlinkOAuthProviderRequestSchema
>;

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

export type RefreshRequestBody = z.infer<typeof refreshRequestSchema>;

export type RemoveKnownDeviceRequestBody = z.infer<
  typeof removeKnownDeviceRequestSchema
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

export interface LocalAuthenticateInput {
  client: ClientRequestContext;
  email: string;
  password: string;
  rememberMe?: boolean;
  deviceId?: string;
}

export interface LocalSignupInput {
  client: ClientRequestContext;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  deviceId?: string;
}

export interface OAuthAuthenticateInput {
  client: ClientRequestContext;
  code?: string;
  codeVerifier?: string;
  idToken?: string;
  nonce: string;
  rememberMe?: boolean;
  deviceId?: string;
  firstName?: string;
  lastName?: string;
}

export interface LinkOAuthProviderInput extends OAuthAuthenticateInput {
  userId: string;
  provider: OAuthProvider;
}

export interface UnlinkOAuthProviderInput {
  userId: string;
  provider: OAuthProvider;
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

export interface RefreshInput {
  client: ClientRequestContext;
  refreshToken?: string;
}

export interface RemoveKnownDeviceInput {
  userId: string;
  deviceId: string;
}

export interface ForgotPasswordInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
}

export interface ResendForgotPasswordInput {
  client: ClientRequestContext;
  email: string;
  deviceId?: string;
}

export interface ResetPasswordInput {
  client: ClientRequestContext;
  email: string;
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

export interface CreateLocalUserInput {
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
}

export interface SignupVerificationPendingResult {
  verificationRequired: true;
  email: string;
  alreadyPending: boolean;
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
