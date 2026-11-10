import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { environment } from "@/configuration/environment";
import ConflictError from "@/errors/http/conflict.error";
import { checkPasswordShape } from "@/features/auth/password/policy/password-rules";

/** The default `authSecurity.passwords.hashCost`. */
export const DEFAULT_BCRYPT_COST = 12;
/**
 * Compared against when an account has no usable password hash, so a login
 * attempt for a missing or social-only account costs the same wall time as one
 * for a real local account and cannot be distinguished by timing. At the
 * default cost; see `getDummyPasswordHash` for any other.
 */
export const DUMMY_PASSWORD_HASH =
  "$2b$12$1M7NQyWNh5v3NFg4cTQdUeVUI5BvR9f0vAOVeI3E1FQfQ0rFJz0Vy";

const BCRYPT_COST_PATTERN = /^\$2[aby]\$(\d{2})\$/;
const dummyHashesByCost = new Map<number, Promise<string>>();

export function configuredBcryptCost(): number {
  return environment.getAuthSecurityConfig().passwords.hashCost;
}

/** The cost a bcrypt hash was made at, or null when it is not bcrypt. */
export function getBcryptCost(passwordHash: string): number | null {
  const match = BCRYPT_COST_PATTERN.exec(passwordHash);

  return match ? Number(match[1]) : null;
}

/** Only ever upwards: lowering the configured cost rehashes nothing. */
export function needsRehash(passwordHash: string): boolean {
  const cost = getBcryptCost(passwordHash);

  return cost !== null && cost < configuredBcryptCost();
}

/**
 * The dummy hash at the configured cost, so an unknown username keeps costing
 * what a real sign-in does after the cost is raised. Made once per cost.
 */
export function getDummyPasswordHash(): Promise<string> {
  const cost = configuredBcryptCost();

  if (cost === DEFAULT_BCRYPT_COST) {
    return Promise.resolve(DUMMY_PASSWORD_HASH);
  }

  let hash = dummyHashesByCost.get(cost);

  if (!hash) {
    hash = bcrypt.hash(randomUUID(), cost);
    dummyHashesByCost.set(cost, hash);
  }

  return hash;
}

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
  return bcrypt.hash(password, configuredBcryptCost());
}

/**
 * Rehashes a password a sign-in has just proven. It skips the new-password
 * rules on purpose: an existing password is not re-checked at sign-in, and one
 * set under the old 8-character rule must still upgrade rather than throw.
 */
export async function rehashVerifiedPassword(
  password: string,
): Promise<string> {
  return bcrypt.hash(password, configuredBcryptCost());
}

export async function verifyPasswordAgainstFakeHash(
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, await getDummyPasswordHash());
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
