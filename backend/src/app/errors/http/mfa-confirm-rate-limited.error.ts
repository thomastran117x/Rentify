import AppError from "./app.error";

class MfaConfirmRateLimitedError extends AppError {
  constructor(message = "Too many MFA verification attempts. Please wait before trying again.", details?: unknown) {
    super(message, 429, "MFA_CONFIRM_RATE_LIMITED", details);
    this.name = "MfaConfirmRateLimitedError";
  }
}

export default MfaConfirmRateLimitedError;
export { MfaConfirmRateLimitedError };
