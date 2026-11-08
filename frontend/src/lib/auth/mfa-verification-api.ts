import { buildPathWithQuery, authenticatedJson } from "@/lib/api/client";

export type MfaVerificationScope = "mfa-management" | "device-login";
export type MfaVerificationFactor = "email" | "totp" | "sms" | "recovery_code";
export type MfaVerificationChallengeFactor = MfaVerificationFactor;

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

export interface MfaVerificationSmsChallengeResult {
  scope: MfaVerificationScope;
  factor: "sms";
  challengeId: null;
  cooldownUntil: string;
}

/** A factor the user already holds, so nothing is sent. */
export interface MfaVerificationPromptChallengeResult {
  scope: MfaVerificationScope;
  factor: "totp" | "recovery_code";
  challengeId: null;
  prompt: true;
}

export type MfaVerificationChallengeResult =
  | MfaVerificationEmailChallengeResult
  | MfaVerificationSmsChallengeResult
  | MfaVerificationPromptChallengeResult;

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

export const mfaVerificationApi = {
  getOptions(
    scope: MfaVerificationScope,
  ): Promise<MfaVerificationOptionsResult> {
    return authenticatedJson<MfaVerificationOptionsResult>(
      "GET",
      buildPathWithQuery("/auth/mfa/verify/options", { scope }),
    );
  },

  issueChallenge(
    scope: MfaVerificationScope,
    factor: MfaVerificationFactor,
  ): Promise<MfaVerificationChallengeResult> {
    return authenticatedJson<
      MfaVerificationChallengeResult,
      { scope: MfaVerificationScope; factor: MfaVerificationFactor }
    >("POST", "/auth/mfa/verify/challenge", { scope, factor });
  },

  confirmChallenge(
    scope: MfaVerificationScope,
    factor: MfaVerificationFactor,
    code: string,
  ): Promise<MfaVerificationConfirmResult> {
    return authenticatedJson<
      MfaVerificationConfirmResult,
      {
        scope: MfaVerificationScope;
        factor: MfaVerificationFactor;
        code: string;
      }
    >("POST", "/auth/mfa/verify/confirm", {
      scope,
      factor,
      code,
    });
  },

  previewEmailOtp(
    scope: MfaVerificationScope,
  ): Promise<MfaVerificationPreviewResult> {
    return authenticatedJson<MfaVerificationPreviewResult>(
      "GET",
      buildPathWithQuery("/auth/mfa/verify/dev/otp", { scope }),
    );
  },
};
