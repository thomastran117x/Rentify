import UnauthorizedError from "./unauthorized.error";
import type { LoginMfaRequiredDetails } from "@/features/auth/mfa/login/login-mfa.model";

/**
 * The first factor passed, but the account needs an authenticator code.
 *
 * Keeps the long-standing `401` with `details.mfaRequired`, so a client that
 * answers it by sending the password again with `totpCode` still works. The
 * challenge token rides along in the same details for clients that finish
 * through `POST /auth/login/mfa` instead.
 */
class LoginMfaRequiredError extends UnauthorizedError {
  constructor(challenge: LoginMfaRequiredDetails) {
    super("Authenticator code is required.", challenge);
    this.name = "LoginMfaRequiredError";
  }
}

export default LoginMfaRequiredError;
export { LoginMfaRequiredError };
