import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

export const MFA_MANAGEMENT_SCOPE = "mfa-management" as const;
export const MFA_DEVICE_LOGIN_SCOPE = "device-login" as const;
export const MFA_PROOF_TTL_MINUTES = 15;
export const MFA_STEP_UP_OTP_PURPOSE = "mfa-step-up" as const;

export const mfaVerificationScopeSchema = z.enum([
  MFA_MANAGEMENT_SCOPE,
  MFA_DEVICE_LOGIN_SCOPE,
]);
export const mfaVerificationFactorSchema = z.enum(["email", "totp", "sms"]);
export const mfaVerificationChallengeFactorSchema = z.enum(["email", "totp"]);

export const mfaVerificationChallengeRequestSchema = z.object({
  scope: mfaVerificationScopeSchema,
  factor: mfaVerificationChallengeFactorSchema,
});

export const mfaVerificationConfirmRequestSchema = z.object({
  scope: mfaVerificationScopeSchema,
  factor: mfaVerificationChallengeFactorSchema,
  code: z.string().trim().min(1, "Code is required."),
});

export type MfaVerificationScope = z.infer<typeof mfaVerificationScopeSchema>;
export type MfaVerificationFactor = z.infer<typeof mfaVerificationFactorSchema>;
export type MfaVerificationChallengeFactor = z.infer<
  typeof mfaVerificationChallengeFactorSchema
>;

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

export interface MfaVerificationTotpChallengeResult {
  scope: MfaVerificationScope;
  factor: "totp";
  challengeId: null;
  prompt: true;
}

export type MfaVerificationChallengeResult =
  | MfaVerificationEmailChallengeResult
  | MfaVerificationTotpChallengeResult;

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
