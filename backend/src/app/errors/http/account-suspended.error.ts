import AppError from "./app.error";

/**
 * A suspended account is a policy action, not a security hold, so it is a 403
 * the user cannot clear themself; only an admin can reinstate it. A security
 * hold uses {@link LockedError} instead.
 */
class AccountSuspendedError extends AppError {
  constructor(
    message = "This account has been suspended. Contact support if you believe this is a mistake.",
    details?: unknown,
  ) {
    super(message, 403, "ACCOUNT_SUSPENDED", details);
    this.name = "AccountSuspendedError";
  }
}

export default AccountSuspendedError;
export { AccountSuspendedError };
