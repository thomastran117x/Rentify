/** How many codes a set holds. */
export const RECOVERY_CODE_COUNT = 10;

export const RECOVERY_CODE_LENGTH = 10;

/**
 * Exactly 32 symbols, so a code drawn from 5 random bits per character has no
 * modulo bias and carries 50 bits. 0, 1, I and O are left out because they are
 * easily misread off paper; L stays because uppercase L is not confused with
 * anything once 1 is gone.
 */
export const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const RECOVERY_CODE_PATTERN = new RegExp(
  `^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`,
);

/**
 * The canonical form of a typed code, or null when it cannot be one. Case,
 * spaces and hyphens are forgiven, since codes are often read off paper.
 */
export function normalizeRecoveryCode(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");

  return RECOVERY_CODE_PATTERN.test(normalized) ? normalized : null;
}

/** `XXXXX-XXXXX`, the form codes are shown in. */
export function formatRecoveryCode(code: string): string {
  const middle = RECOVERY_CODE_LENGTH / 2;

  return `${code.slice(0, middle)}-${code.slice(middle)}`;
}

/** A row ready to insert; the code itself is never persisted. */
export interface NewRecoveryCodeRow {
  id: string;
  userId: string;
  codeHash: string;
}

/** A freshly generated set: `codes` go to the user once, `rows` to the table. */
export interface RecoveryCodeSet {
  codes: string[];
  rows: NewRecoveryCodeRow[];
}

export interface MfaRecoveryCodeStatusResult {
  remaining: number;
  /** When the current set was generated; null if the account never had one. */
  createdAt: string | null;
}

export interface MfaRecoveryCodeRegenerateResult
  extends MfaRecoveryCodeStatusResult {
  /** Shown once. They cannot be read back. */
  codes: string[];
}

/** Where a code was spent, recorded on the audit event. */
export type RecoveryCodeStage = "login" | "step_up";
