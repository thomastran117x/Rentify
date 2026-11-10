import {
  authenticatedJson,
  authenticatedJsonOnce,
  buildPathWithQuery,
} from "@/lib/api/client";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@/lib/auth/webauthn";

export type MfaVerificationScope = "mfa-management" | "device-login";
export type MfaVerificationFactor =
  | "email"
  | "totp"
  | "sms"
  | "recovery_code"
  | "passkey";
export type MfaVerificationChallengeFactor = MfaVerificationFactor;
/** The factors confirmed with a typed code, rather than a passkey. */
export type MfaVerificationCodeFactor = Exclude<
  MfaVerificationFactor,
  "passkey"
>;

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

/** The options the browser's passkey prompt answers. */
export interface MfaVerificationPasskeyChallengeResult {
  scope: MfaVerificationScope;
  factor: "passkey";
  challengeId: null;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export type MfaVerificationChallengeResult =
  | MfaVerificationEmailChallengeResult
  | MfaVerificationSmsChallengeResult
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
    factor: MfaVerificationCodeFactor,
    code: string,
  ): Promise<MfaVerificationConfirmResult> {
    return authenticatedJson<
      MfaVerificationConfirmResult,
      {
        scope: MfaVerificationScope;
        factor: MfaVerificationCodeFactor;
        code: string;
      }
    >("POST", "/auth/mfa/verify/confirm", {
      scope,
      factor,
      code,
    });
  },

  /**
   * Sent once: an assertion answers a single-use challenge, so the usual
   * refresh-and-resend would only send a spent answer.
   */
  confirmPasskey(
    scope: MfaVerificationScope,
    credential: AuthenticationResponseJSON,
  ): Promise<MfaVerificationConfirmResult> {
    return authenticatedJsonOnce<
      MfaVerificationConfirmResult,
      {
        scope: MfaVerificationScope;
        factor: "passkey";
        credential: AuthenticationResponseJSON;
      }
    >("POST", "/auth/mfa/verify/confirm", {
      scope,
      factor: "passkey",
      credential,
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
