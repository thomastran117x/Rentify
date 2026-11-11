import { authenticatedJsonOnce } from "@/lib/api/client";
import {
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  patchAuthenticatedJson,
  postAuthenticatedJson,
} from "@/lib/auth/api";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@/lib/auth/webauthn";

export type PasskeyTransport =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

/** A passkey as the account page shows it. Keys never leave the backend. */
export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Synced to a backup by the authenticator, such as iCloud Keychain. */
  backedUp: boolean;
  deviceType: "single_device" | "multi_device";
  transports: PasskeyTransport[];
}

export interface PasskeyRegistrationResult {
  passkey: PasskeySummary;
  /** The account's first recovery codes, shown once; absent when it had a set. */
  recoveryCodes?: string[];
}

export const passkeysApi = {
  list(): Promise<{ passkeys: PasskeySummary[] }> {
    return getAuthenticatedJson<{ passkeys: PasskeySummary[] }>(
      "/auth/mfa/passkeys",
    );
  },

  getRegistrationOptions(): Promise<{
    options: PublicKeyCredentialCreationOptionsJSON;
  }> {
    return postAuthenticatedJson<
      { options: PublicKeyCredentialCreationOptionsJSON },
      Record<string, never>
    >("/auth/mfa/passkeys/register/options", {});
  },

  /**
   * Sent once: the attestation answers a single-use challenge, so the usual
   * refresh-and-resend would only send a spent answer.
   */
  verifyRegistration(
    credential: RegistrationResponseJSON,
    name?: string,
  ): Promise<PasskeyRegistrationResult> {
    return authenticatedJsonOnce<
      PasskeyRegistrationResult,
      { credential: RegistrationResponseJSON; name?: string }
    >("POST", "/auth/mfa/passkeys/register/verify", { credential, name });
  },

  rename(id: string, name: string): Promise<{ passkey: PasskeySummary }> {
    return patchAuthenticatedJson<
      { passkey: PasskeySummary },
      { name: string }
    >(`/auth/mfa/passkeys/${encodeURIComponent(id)}`, { name });
  },

  remove(id: string): Promise<void> {
    return deleteAuthenticatedJson<void>(
      `/auth/mfa/passkeys/${encodeURIComponent(id)}`,
    );
  },
};

/**
 * A name for a new passkey from the browser it is made in, such as "Chrome on
 * Windows". The user can change it before saving and rename it later.
 */
export function suggestPasskeyName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;

  if (browser && platform) {
    return `${browser} on ${platform}`;
  }

  return browser ?? platform ?? "Passkey";
}
