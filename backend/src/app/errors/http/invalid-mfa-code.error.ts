import AppError from "./app.error";

class InvalidMfaCodeError extends AppError {
  constructor(
    message = "The verification code is invalid or has expired.",
    details?: unknown,
  ) {
    super(message, 400, "INVALID_MFA_CODE", details);
    this.name = "InvalidMfaCodeError";
  }
}

export default InvalidMfaCodeError;
export { InvalidMfaCodeError };
