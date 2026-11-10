import { createHash } from "node:crypto";
import { environment } from "@/configuration/environment";
import { assertTrustedOutboundUrl } from "@/features/security/outbound-request-guard";

/** Have I Been Pwned's Pwned Passwords range API. It needs no key. */
export const PWNED_PASSWORDS_HOST = "api.pwnedpasswords.com";
const RANGE_URL = `https://${PWNED_PASSWORDS_HOST}/range/`;
const PREFIX_LENGTH = 5;

export type BreachCheckResult =
  | { status: "breached"; count: number }
  | { status: "clean" }
  | { status: "unavailable"; reason: "timeout" | "network" | "http" };

export interface BreachedPasswordChecker {
  check(password: string): Promise<BreachCheckResult>;
}

export type PwnedPasswordsClientOptions = {
  /** Read on every check, so a config change applies without a restart. */
  getTimeoutMs?: () => number;
};

/**
 * Asks whether a password has appeared in a known breach without disclosing
 * it (k-anonymity). Only the first five hex characters of its SHA-1 leave the
 * server. The API answers with every suffix in that range, padded with decoys
 * (`Add-Padding`) so the response size gives nothing away either, and the
 * match is made here.
 *
 * Never throws: an outage or timeout is `unavailable`, and the caller decides
 * what that means.
 */
export class PwnedPasswordsClient implements BreachedPasswordChecker {
  private readonly getTimeoutMs: () => number;

  constructor(options: PwnedPasswordsClientOptions = {}) {
    this.getTimeoutMs =
      options.getTimeoutMs ??
      (() =>
        environment.getAuthSecurityConfig().passwords.breachCheck.timeoutMs);
  }

  async check(password: string): Promise<BreachCheckResult> {
    const hash = createHash("sha1")
      .update(password, "utf8")
      .digest("hex")
      .toUpperCase();
    const prefix = hash.slice(0, PREFIX_LENGTH);
    const suffix = hash.slice(PREFIX_LENGTH);
    const url = assertTrustedOutboundUrl(`${RANGE_URL}${prefix}`, {
      allowedHosts: [PWNED_PASSWORDS_HOST],
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "add-padding": "true",
          "user-agent": "Rentify-password-check",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return { status: "unavailable", reason: "http" };
      }

      const count = findSuffixCount(await response.text(), suffix);

      return count > 0 ? { status: "breached", count } : { status: "clean" };
    } catch {
      return {
        status: "unavailable",
        reason: controller.signal.aborted ? "timeout" : "network",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Padding rows carry a count of 0, so they never match as breached. */
function findSuffixCount(body: string, suffix: string): number {
  for (const line of body.split(/\r?\n/)) {
    const [candidate, rawCount] = line.trim().split(":");

    if (candidate?.toUpperCase() === suffix) {
      const count = Number.parseInt(rawCount ?? "", 10);

      return Number.isFinite(count) ? count : 0;
    }
  }

  return 0;
}
