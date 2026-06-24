import {
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  postAuthenticatedJson,
} from "@/lib/auth/api";

export interface MfaTotpStatusResult {
  enabled: boolean;
}

export interface MfaTotpBeginResult {
  secret: string;
  uri: string;
}

export const mfaTotpApi = {
  getStatus(): Promise<MfaTotpStatusResult> {
    return getAuthenticatedJson<MfaTotpStatusResult>("/auth/mfa/totp/status");
  },

  beginEnrollment(accountName?: string): Promise<MfaTotpBeginResult> {
    return postAuthenticatedJson<MfaTotpBeginResult, { accountName?: string }>(
      "/auth/mfa/totp/begin",
      { accountName },
    );
  },

  confirmEnrollment(code: string): Promise<{ confirmed: true }> {
    return postAuthenticatedJson<{ confirmed: true }, { code: string }>(
      "/auth/mfa/totp/confirm",
      { code },
    );
  },

  disable(): Promise<{ disabled: true }> {
    return deleteAuthenticatedJson<{ disabled: true }>("/auth/mfa/totp");
  },
};
