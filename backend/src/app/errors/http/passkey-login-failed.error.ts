import AppError from "./app.error";

/**
 * A sign-in with a passkey alone was refused: the challenge had expired or
 * been used, the passkey is not registered, or its assertion did not check
 * out. One message for all of them, so the answer never says whether a
 * passkey or an account exists. The client asks for new options and tries
 * again.
 */
class PasskeyLoginFailedError extends AppError {
  constructor(
    message = "We couldn't sign you in with that passkey. Try again, or sign in with your username and password.",
    details?: unknown,
  ) {
    super(message, 401, "PASSKEY_LOGIN_FAILED", details);
    this.name = "PasskeyLoginFailedError";
  }
}

export default PasskeyLoginFailedError;
export { PasskeyLoginFailedError };
