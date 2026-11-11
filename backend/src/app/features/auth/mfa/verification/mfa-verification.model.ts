import { z } from "zod";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import type { Uuid } from "@/configuration/validation/uuid";
import {
  passkeyAssertionCredentialSchema,
  type PasskeyAssertionCredential,
} from "@/features/auth/mfa/passkey/passkey.model";

export const MFA_MANAGEMENT_SCOPE = "mfa-management" as const;
export const MFA_DEVICE_LOGIN_SCOPE = "device-login" as const;
export const MFA_PROOF_TTL_MINUTES = 15;
export const MFA_STEP_UP_OTP_PURPOSE = "mfa-step-up" as const;

export const mfaVerificationScopeSchema = z.enum([
  MFA_MANAGEMENT_SCOPE,
  MFA_DEVICE_LOGIN_SCOPE,
]);
export const mfaVerificationFactorSchema = z.enum([
  "email",
  "totp",
  "sms",
  "recovery_code",
  "passkey",
]);
export const mfaVerificationChallengeFactorSchema = z.enum([
  "email",
  "totp",
  "recovery_code",
  "passkey",
]);
/** The factors confirmed with a typed code, rather than a passkey assertion. */
export const mfaVerificationCodeFactorSchema = z.enum([
  "email",
  "totp",
  "recovery_code",
]);

export const mfaVerificationChallengeRequestSchema = z.object({
  scope: mfaVerificationScopeSchema,
  factor: mfaVerificationChallengeFactorSchema,
});

export const mfaVerificationConfirmRequestSchema = z.discriminatedUnion(
  "factor",
  [
    z.object({
      scope: mfaVerificationScopeSchema,
      factor: z.literal("passkey"),
      credential: passkeyAssertionCredentialSchema,
    }),
    z.object({
      scope: mfaVerificationScopeSchema,
      factor: mfaVerificationCodeFactorSchema,
      code: z.string().trim().min(1, "Code is required."),
    }),
  ],
);

export type MfaVerificationScope = z.infer<typeof mfaVerificationScopeSchema>;
export type MfaVerificationFactor = z.infer<typeof mfaVerificationFactorSchema>;
export type MfaVerificationChallengeFactor = z.infer<
  typeof mfaVerificationChallengeFactorSchema
>;
export type MfaVerificationCodeFactor = z.infer<
  typeof mfaVerificationCodeFactorSchema
>;

/** What a confirm carries: a typed code, or a passkey assertion. */
export type MfaVerificationAnswer =
  | { factor: MfaVerificationCodeFactor; code: string }
  | { factor: "passkey"; credential: PasskeyAssertionCredential };

export interface MfaVerificationProofRecord {
  userId: Uuid;
  sessionId: string;
  scope: MfaVerificationScope;
  factor: MfaVerificationChallengeFactor;
  verifiedAt: string;
  verifiedUntil: string;
  securityVersion: string;
}

export interface MfaVerificationOptionsResult {
  scope: MfaVerificationScope;
  verified: boolean;
  verifiedUntil: string | null;
  availableFactors: MfaVerificationFactor[];
  recommendedFactor: MfaVerificationFactor | null;
}

export interface MfaVerificationEmailChallengeResult {
  scope: MfaVerificationScope;
  factor: "email";
  challengeId: null;
  cooldownUntil: string;
}

/** A factor the user already holds, so there is nothing to send. */
export interface MfaVerificationPromptChallengeResult {
  scope: MfaVerificationScope;
  factor: "totp" | "recovery_code";
  challengeId: null;
  prompt: true;
}

/** The options `navigator.credentials.get()` answers, for one of the account's passkeys. */
export interface MfaVerificationPasskeyChallengeResult {
  scope: MfaVerificationScope;
  factor: "passkey";
  challengeId: null;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export type MfaVerificationChallengeResult =
  | MfaVerificationEmailChallengeResult
  | MfaVerificationPromptChallengeResult
  | MfaVerificationPasskeyChallengeResult;

export interface MfaVerificationConfirmResult {
  verified: true;
  scope: MfaVerificationScope;
  factor: MfaVerificationChallengeFactor;
  verifiedUntil: string;
}

export interface MfaVerificationPreviewResult {
  scope: MfaVerificationScope;
  factor: "email";
  code: string;
  expiresInSeconds: number;
}
