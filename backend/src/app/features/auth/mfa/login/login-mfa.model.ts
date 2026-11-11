import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  optionalTrimmedString,
  requiredSafeTrimmedString,
  type OAuthProvider,
} from "@/features/auth/auth.model";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { Uuid } from "@/configuration/validation/uuid";
import {
  passkeyAssertionCredentialSchema,
  type PasskeyAssertionCredential,
} from "@/features/auth/mfa/passkey/passkey.model";

/**
 * The second factors a sign-in can be finished with, strongest first. A
 * challenge lists the ones this account can use.
 */
export const LOGIN_MFA_FACTORS = ["passkey", "totp", "recovery_code"] as const;

export const loginMfaFactorSchema = z.enum(LOGIN_MFA_FACTORS);

export type LoginMfaFactor = z.infer<typeof loginMfaFactorSchema>;

/** The factors a sign-in is finished with by typing a code. */
export const loginMfaCodeFactorSchema = z.enum(["totp", "recovery_code"]);

export type LoginMfaCodeFactor = z.infer<typeof loginMfaCodeFactorSchema>;

/** How the first step proved who the user is. */
export type LoginMfaMethod = "password" | OAuthProvider;

const mfaChallengeToken = requiredSafeTrimmedString(
  "MFA challenge token is required.",
);

export const loginMfaRequestSchema = z.discriminatedUnion("factor", [
  z.object({
    mfaChallengeToken,
    factor: z.literal("passkey"),
    credential: passkeyAssertionCredentialSchema,
    deviceId: optionalTrimmedString,
  }),
  z.object({
    mfaChallengeToken,
    factor: loginMfaCodeFactorSchema,
    code: z.string().trim().min(1, "Code is required."),
    deviceId: optionalTrimmedString,
  }),
]);

export type LoginMfaRequestBody = z.infer<typeof loginMfaRequestSchema>;

export const loginMfaPasskeyOptionsRequestSchema = z.object({
  mfaChallengeToken,
  deviceId: optionalTrimmedString,
});

export type LoginMfaPasskeyOptionsRequestBody = z.infer<
  typeof loginMfaPasskeyOptionsRequestSchema
>;

/** What the second step carries: a typed code, or a passkey assertion. */
export type LoginMfaAnswer =
  | { factor: LoginMfaCodeFactor; code: string }
  | { factor: "passkey"; credential: PasskeyAssertionCredential };

/**
 * The `details` of the `401` the first step answers with, instead of a
 * session, when the account needs a second factor. The token is the only
 * thing the client keeps between steps.
 */
export interface LoginMfaRequiredDetails {
  mfaRequired: true;
  mfaChallengeToken: string;
  availableFactors: LoginMfaFactor[];
  expiresInSeconds: number;
}

/**
 * Everything the second step needs, captured when the first step succeeded,
 * so the client never has to send the password or provider token again.
 */
export interface LoginMfaChallengeRecord {
  userId: Uuid;
  method: LoginMfaMethod;
  /**
   * The lockout key. Wrong codes count against the username lock, which is
   * what limits guessing; the challenge itself keeps no count.
   */
  username: string;
  identifierHash?: string;
  deviceId?: string;
  rememberMe?: boolean;
  /** A password change or sign-out-everywhere in between voids the challenge. */
  tokenVersion: number;
  createdAt: string;
}

export type NewLoginMfaChallenge = Omit<LoginMfaChallengeRecord, "createdAt">;

export type CompleteLoginMfaInput = LoginMfaAnswer & {
  client: ClientRequestContext;
  mfaChallengeToken: string;
  deviceId?: string;
  audit: AuthAuditContext;
};

export interface BeginLoginPasskeyInput {
  mfaChallengeToken: string;
  deviceId?: string;
  audit: AuthAuditContext;
}
