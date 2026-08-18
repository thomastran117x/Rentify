/**
 * Mirrors the backend `strongPasswordSchema` in
 * `backend/src/app/features/auth/auth.model.ts` so the forms reject a weak
 * password before spending a request on a guaranteed 400. Keep the two in sync.
 */
export const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.";

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
