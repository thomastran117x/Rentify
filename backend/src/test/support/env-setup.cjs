// Sets environment variables required at DI container registration time
// that are not part of the typed environment stub.
process.env.MFA_TOTP_ENCRYPTION_KEY = "0".repeat(64);
