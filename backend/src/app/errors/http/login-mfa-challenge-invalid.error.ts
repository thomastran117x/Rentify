import AppError from "./app.error";

/**
 * The second step of a sign-in named a challenge that is unknown, already
 * used, expired, or was issued to a different device. The client has to start
 * the sign-in again.
 */
class LoginMfaChallengeInvalidError extends AppError {
  constructor() {
    super(
      "This sign-in has expired. Sign in again to continue.",
      401,
      "MFA_CHALLENGE_INVALID",
    );
    this.name = "LoginMfaChallengeInvalidError";
  }
}

export default LoginMfaChallengeInvalidError;
export { LoginMfaChallengeInvalidError };
