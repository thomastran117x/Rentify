import AppError from "./app.error";

class MfaChallengeRateLimitedError extends AppError {
  constructor(
    message = "Please wait before requesting another MFA verification challenge.",
    details?: unknown,
  ) {
    super(message, 429, "MFA_CHALLENGE_RATE_LIMITED", details);
    this.name = "MfaChallengeRateLimitedError";
  }
}

export default MfaChallengeRateLimitedError;
export { MfaChallengeRateLimitedError };
