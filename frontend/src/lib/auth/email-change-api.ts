import { publicJson } from "@/lib/api/client";
import {
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  postAuthenticatedJson,
} from "@/lib/auth/api";
import type { AuthResponseBody } from "@/lib/auth/types";

/**
 * `newEmail` comes back redacted. The address is echoed as `o***@example.com`
 * because the pending state is readable by any session on the account, so the
 * client shows the address it still holds locally and falls back to this only
 * after a reload.
 */
export interface EmailChangeRequestResult {
  newEmail: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

export interface PendingEmailChangeResult {
  pending: boolean;
  newEmail?: string;
  expiresInSeconds?: number;
}

export interface EmailChangeOtpPreviewResult {
  code: string;
  expiresInSeconds: number;
}

export type EmailChangeRevertNextStep = "reset_password" | "sign_in";

export interface EmailChangeRevertResult {
  reverted: true;
  nextStep: EmailChangeRevertNextStep;
}

export const emailChangeApi = {
  /** Requires a recent `mfa-management` step-up; 401s with `MFA_VERIFICATION_REQUIRED` without one. */
  request(email: string): Promise<EmailChangeRequestResult> {
    return postAuthenticatedJson<EmailChangeRequestResult, { email: string }>(
      "/auth/email/change",
      { email },
    );
  },

  resend(): Promise<EmailChangeRequestResult> {
    return postAuthenticatedJson<EmailChangeRequestResult>(
      "/auth/email/change/resend",
      {},
    );
  },

  /** Returns a full session: the token version rotates, so the old one dies here. */
  confirm(code: string): Promise<AuthResponseBody> {
    return postAuthenticatedJson<AuthResponseBody, { code: string }>(
      "/auth/email/change/confirm",
      { code },
    );
  },

  /**
   * Public: the token from the `email_changed` email is the only credential. A
   * spent, expired or superseded token rejects with a 410.
   */
  revertWithToken(token: string): Promise<EmailChangeRevertResult> {
    return publicJson<EmailChangeRevertResult, { token: string }>(
      "POST",
      "/auth/email/change/revert",
      { token },
    );
  },

  pending(): Promise<PendingEmailChangeResult> {
    return getAuthenticatedJson<PendingEmailChangeResult>("/auth/email/change");
  },

  cancel(): Promise<void> {
    return deleteAuthenticatedJson<void>("/auth/email/change");
  },

  /** Non-production only; the route is not registered otherwise. */
  previewCode(): Promise<EmailChangeOtpPreviewResult> {
    return getAuthenticatedJson<EmailChangeOtpPreviewResult>(
      "/auth/email/change/dev/otp",
    );
  },
};
