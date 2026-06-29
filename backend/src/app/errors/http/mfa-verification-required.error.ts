import AppError from "./app.error";

class MfaVerificationRequiredError extends AppError {
  constructor(details?: unknown) {
    super(
      "Recent MFA verification is required.",
      401,
      "MFA_VERIFICATION_REQUIRED",
      details,
    );
    this.name = "MfaVerificationRequiredError";
  }
}

export default MfaVerificationRequiredError;
export { MfaVerificationRequiredError };
