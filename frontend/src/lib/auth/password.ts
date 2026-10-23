/**
 * Mirrors the backend `strongPasswordSchema` in
 * `backend/src/app/features/auth/auth.model.ts` so the forms reject a password
 * the server would refuse before spending a request on a guaranteed 400. Keep
 * the two in sync -- including the unsafe-input rule, which is easy to miss
 * because it lives in a separate refine.
 */
export const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.";

export const UNSAFE_AUTH_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";

const UNSAFE_AUTH_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

export function containsUnsafeAuthInput(value: string): boolean {
  return UNSAFE_AUTH_INPUT_PATTERN.test(value);
}

export interface PasswordRequirement {
  id: "length" | "uppercase" | "lowercase" | "number" | "special";
  label: string;
  test: (password: string) => boolean;
}

/**
 * The character rules `isStrongPassword` enforces, one per checklist row. The
 * unsafe-input rule is deliberately absent: it is a rejection, not something a
 * user works towards, so it surfaces only as an error message.
 */
export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    id: "length",
    label: "At least 8 characters",
    test: (password) => password.length >= 8,
  },
  {
    id: "uppercase",
    label: "An uppercase letter",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "A lowercase letter",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "A number",
    test: (password) => /\d/.test(password),
  },
  {
    id: "special",
    label: "A special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

export function isStrongPassword(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every((requirement) =>
    requirement.test(password),
  );
}

/**
 * Returns the message the backend would return, or null when the password
 * passes. The order matches the zod schema: length, then unsafe input, then
 * character classes.
 */
export function getPasswordStrengthError(password: string): string | null {
  if (password.length < 8) {
    return STRONG_PASSWORD_MESSAGE;
  }

  if (containsUnsafeAuthInput(password)) {
    return UNSAFE_AUTH_INPUT_MESSAGE;
  }

  if (!isStrongPassword(password)) {
    return STRONG_PASSWORD_MESSAGE;
  }

  return null;
}
