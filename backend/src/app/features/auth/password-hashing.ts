import bcrypt from "bcrypt";
import ConflictError from "@/errors/http/conflict.error";
import { checkPasswordShape } from "@/features/auth/password/policy/password-rules";

export const BCRYPT_SALT_ROUNDS = 12;
/**
 * Compared against when an account has no usable password hash, so a login
 * attempt for a missing or social-only account costs the same wall time as one
 * for a real local account and cannot be distinguished by timing.
 */
export const DUMMY_PASSWORD_HASH =
  "$2b$12$1M7NQyWNh5v3NFg4cTQdUeVUI5BvR9f0vAOVeI3E1FQfQ0rFJz0Vy";

export function isBcryptHash(passwordHash: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(passwordHash);
}

/**
 * A last guard before a new password is hashed. The request schemas reject a
 * bad shape first with a 400, so reaching this throw is a programming error.
 */
export function assertValidPassword(password: string): void {
  const [issue] = checkPasswordShape(password);

  if (issue) {
    throw new Error(issue.message);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertValidPassword(password);
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

export async function verifyPasswordAgainstFakeHash(
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, DUMMY_PASSWORD_HASH);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return isBcryptHash(passwordHash)
    ? bcrypt.compare(password, passwordHash)
    : verifyPasswordAgainstFakeHash(password);
}

export async function rejectIfPasswordMatchesCurrent(
  password: string,
  passwordHash: string,
): Promise<void> {
  const matchesCurrentPassword = await verifyPassword(password, passwordHash);

  if (matchesCurrentPassword) {
    throw new ConflictError(
      "New password must be different from the current password.",
    );
  }
}
