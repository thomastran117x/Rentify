import { cancelStoredSessionRefresh, publicJson } from "@/lib/api/client";
import { postAuthenticatedJson } from "@/lib/auth/api";

export interface SelfLockResult {
  locked: true;
}

/**
 * "This wasn't me": puts the account on a security hold, which signs every
 * session out until the password is reset.
 */
export const selfLockApi = {
  /**
   * Public: the emailed token is the only credential. A spent, expired or
   * unknown token rejects with a 410.
   */
  lockWithToken(token: string): Promise<SelfLockResult> {
    return publicJson<SelfLockResult, { token: string }>(
      "POST",
      "/auth/account/self-lock",
      { token },
    );
  },

  /** Requires a recent `mfa-management` step-up; 401s with `MFA_VERIFICATION_REQUIRED` without one. */
  lockCurrentSession(): Promise<SelfLockResult> {
    // The lock ends this session too, so a refresh must not race it.
    cancelStoredSessionRefresh();
    return postAuthenticatedJson<SelfLockResult, Record<string, never>>(
      "/auth/account/self-lock/session",
      {},
    );
  },
};
