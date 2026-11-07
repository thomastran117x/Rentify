import { getAuthenticatedJson, postAuthenticatedJson } from "@/lib/auth/api";

/** A warning starts here, while there is still a code left to act with. */
export const RECOVERY_CODES_LOW_THRESHOLD = 2;

export interface MfaRecoveryCodeStatusResult {
  remaining: number;
  /** Null for an account that has never had a set. */
  createdAt: string | null;
}

export interface MfaRecoveryCodeRegenerateResult {
  /** Shown once. They cannot be read back. */
  codes: string[];
  remaining: number;
  createdAt: string;
}

export const mfaRecoveryCodesApi = {
  getStatus(): Promise<MfaRecoveryCodeStatusResult> {
    return getAuthenticatedJson<MfaRecoveryCodeStatusResult>(
      "/auth/mfa/recovery-codes/status",
    );
  },

  regenerate(): Promise<MfaRecoveryCodeRegenerateResult> {
    return postAuthenticatedJson<
      MfaRecoveryCodeRegenerateResult,
      Record<string, never>
    >("/auth/mfa/recovery-codes/regenerate", {});
  },
};
