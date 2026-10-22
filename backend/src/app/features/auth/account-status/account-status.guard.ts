import AccountSuspendedError from "@/errors/http/account-suspended.error";
import LockedError from "@/errors/http/locked.error";
import type { AccountStatus } from "@/features/auth/auth.model";
import type { AuthAuditReasonCode } from "@/features/auth/audit/auth-audit.model";

/**
 * The details on a security-hold 423. They tell the client this is not the
 * temporary password lockout (whose details carry `unlockRequired`), and that
 * a password reset is what clears it.
 */
export const SECURITY_HOLD_DETAILS = {
  reason: "security_hold",
  recovery: "password_reset",
} as const;

export const SECURITY_HOLD_MESSAGE =
  "This account is on a security hold. Reset your password to recover it.";

export type BlockedAccountStatus = Exclude<AccountStatus, "active">;

/**
 * Throws the sign-in error for a locked (423) or suspended (403) account.
 * Callers that issue a session run this only once the credentials are proven,
 * so the status of an account is never revealed to someone who cannot sign in
 * to it.
 */
export function assertAccountIsActive(user: { status: AccountStatus }): void {
  if (user.status === "locked") {
    throw new LockedError(SECURITY_HOLD_MESSAGE, SECURITY_HOLD_DETAILS);
  }

  if (user.status === "suspended") {
    throw new AccountSuspendedError();
  }
}

/** The `login.failed` reason recorded when a sign-in is refused by status. */
export function toBlockedAccountReasonCode(
  status: BlockedAccountStatus,
): AuthAuditReasonCode {
  return status === "locked" ? "account_locked" : "account_suspended";
}
