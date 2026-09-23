import AppError from "./app.error";

class OAuthSignupContinuationExpiredError extends AppError {
  constructor() {
    super(
      "This social signup session has expired. Start again to continue.",
      410,
      "OAUTH_SIGNUP_CONTINUATION_EXPIRED",
    );
    this.name = "OAuthSignupContinuationExpiredError";
  }
}

export default OAuthSignupContinuationExpiredError;
export { OAuthSignupContinuationExpiredError };
