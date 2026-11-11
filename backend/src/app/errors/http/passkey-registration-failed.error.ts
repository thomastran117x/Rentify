import AppError from "./app.error";

/**
 * A passkey's attestation could not be checked against the challenge, origin
 * or RP ID it was issued for, or the challenge had already expired or been
 * used. The client starts the registration again.
 */
class PasskeyRegistrationFailedError extends AppError {
  constructor(
    message = "That passkey could not be added. Start again and use the same device to finish.",
    details?: unknown,
  ) {
    super(message, 400, "PASSKEY_REGISTRATION_FAILED", details);
    this.name = "PasskeyRegistrationFailedError";
  }
}

export default PasskeyRegistrationFailedError;
export { PasskeyRegistrationFailedError };
