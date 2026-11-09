/**
 * The shape rules every new local password must satisfy, shared by the request
 * schemas, the hashing guard and the password policy service.
 *
 * Length is the rule (NIST SP 800-63B): there are no composition requirements.
 * The upper bound is bcrypt's, which ignores everything after the first 72
 * bytes; two passwords sharing that prefix would otherwise be the same password.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
export const PASSWORD_TOO_LONG_MESSAGE = `Password must be at most ${PASSWORD_MAX_BYTES} bytes. Shorten it, or use fewer accented or special characters.`;

export const PASSWORD_ISSUE_CODES = [
  "too_short",
  "too_long",
  "common",
  "contains_personal_info",
  "breached",
] as const;

export type PasswordIssueCode = (typeof PASSWORD_ISSUE_CODES)[number];

export type PasswordIssue = {
  code: PasswordIssueCode;
  message: string;
};

/** Counted in code points, so an emoji is one character, as a person counts it. */
export function passwordLength(password: string): number {
  return [...password].length;
}

export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, "utf8");
}

export function checkPasswordShape(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];

  if (passwordLength(password) < PASSWORD_MIN_LENGTH) {
    issues.push({ code: "too_short", message: PASSWORD_TOO_SHORT_MESSAGE });
  }

  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    issues.push({ code: "too_long", message: PASSWORD_TOO_LONG_MESSAGE });
  }

  return issues;
}
