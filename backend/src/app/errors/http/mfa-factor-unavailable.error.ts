import AppError from "./app.error";

class MfaFactorUnavailableError extends AppError {
  constructor(message = "That verification method is not currently available.", details?: unknown) {
    super(message, 400, "MFA_FACTOR_UNAVAILABLE", details);
    this.name = "MfaFactorUnavailableError";
  }
}

export default MfaFactorUnavailableError;
export { MfaFactorUnavailableError };
