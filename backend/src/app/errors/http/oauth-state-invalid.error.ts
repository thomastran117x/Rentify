import AppError from "./app.error";

/**
 * The callback named a sign-in attempt the server cannot vouch for: one it
 * never started, one already used or expired, or one started for another
 * provider, purpose, device, or account. The message is the same in every
 * case so a caller cannot probe which check failed.
 */
class OAuthStateInvalidError extends AppError {
  constructor() {
    super(
      "This sign-in attempt has expired or was already used. Start again to continue.",
      401,
      "OAUTH_STATE_INVALID",
    );
    this.name = "OAuthStateInvalidError";
  }
}

export default OAuthStateInvalidError;
export { OAuthStateInvalidError };
