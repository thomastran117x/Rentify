import { ApiClientError } from "@/lib/api/types";

/**
 * Why a sign-in was refused by the account's durable status. A security hold
 * is a 423 whose details name `security_hold` (the temporary password lockout
 * is also a 423, with `unlockRequired` instead); a suspension is a 403.
 */
export type AccountStatusBlock =
  | { kind: "security_hold"; message: string }
  | { kind: "suspended"; message: string };

export const SECURITY_HOLD_MESSAGE =
  "This account is on a security hold to protect it. Reset your password to get back in.";

export const ACCOUNT_SUSPENDED_MESSAGE =
  "This account has been suspended. Contact support if you believe this is a mistake.";

export function getAccountStatusBlock(
  error: unknown,
): AccountStatusBlock | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }

  const details =
    typeof error.details === "object" && error.details !== null
      ? (error.details as { reason?: unknown })
      : null;

  if (
    error.status === 423 &&
    error.code === "ACCOUNT_LOCKED" &&
    details?.reason === "security_hold"
  ) {
    return { kind: "security_hold", message: SECURITY_HOLD_MESSAGE };
  }

  if (error.status === 403 && error.code === "ACCOUNT_SUSPENDED") {
    return { kind: "suspended", message: ACCOUNT_SUSPENDED_MESSAGE };
  }

  return null;
}
