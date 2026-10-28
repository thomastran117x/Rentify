import { z } from "zod";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  optionalTrimmedString,
  requiredSafeTrimmedString,
  type OAuthProvider,
} from "@/features/auth/auth.model";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { Uuid } from "@/configuration/validation/uuid";

/**
 * The second factors a sign-in can be finished with. Recovery codes and
 * passkeys join this list without changing the shape of the challenge.
 */
export const LOGIN_MFA_FACTORS = ["totp"] as const;

export const loginMfaFactorSchema = z.enum(LOGIN_MFA_FACTORS);

export type LoginMfaFactor = z.infer<typeof loginMfaFactorSchema>;

/** How the first step proved who the user is. */
export type LoginMfaMethod = "password" | OAuthProvider;

export const loginMfaRequestSchema = z.object({
  mfaChallengeToken: requiredSafeTrimmedString(
    "MFA challenge token is required.",
  ),
  factor: loginMfaFactorSchema,
  code: z.string().trim().min(1, "Code is required."),
  deviceId: optionalTrimmedString,
});

export type LoginMfaRequestBody = z.infer<typeof loginMfaRequestSchema>;

/**
 * What the first step returns instead of a session when the account needs a
 * second factor. The token is the only thing the client keeps between steps.
 */
export interface LoginMfaRequiredResult {
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
  /** The lockout key: failed codes count against the same username lock. */
  username: string;
  identifierHash?: string;
  deviceId?: string;
  rememberMe?: boolean;
  /** A password change or sign-out-everywhere in between voids the challenge. */
  tokenVersion: number;
  failedAttempts: number;
  createdAt: string;
}

export type NewLoginMfaChallenge = Omit<
  LoginMfaChallengeRecord,
  "failedAttempts" | "createdAt"
>;

export interface CompleteLoginMfaInput {
  client: ClientRequestContext;
  mfaChallengeToken: string;
  factor: LoginMfaFactor;
  code: string;
  deviceId?: string;
  audit: AuthAuditContext;
}
