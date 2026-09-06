/**
 * The email rule, in one place.
 *
 * This is deliberately laxer than a full RFC 5322 parser: the field's job is to
 * catch obvious typos before a request goes out, and the backend's `z.email()`
 * is the authority. Rejecting an unusual but valid address here would lock
 * someone out of signup for no benefit.
 */

export const EMAIL_MAX_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_REQUIRED_MESSAGE = "Email is required.";
export const EMAIL_RULE_MESSAGE = "Enter a valid email address.";

/** Matches the backend's `.trim().toLowerCase()` normalization. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hasValidEmailFormat(value: string): boolean {
  const normalized = value.trim();

  return (
    normalized.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(normalized)
  );
}

/** Returns the error message for an invalid email, or undefined when it is valid. */
export function validateEmailFormat(value: string): string | undefined {
  if (!value.trim()) {
    return EMAIL_REQUIRED_MESSAGE;
  }

  if (!hasValidEmailFormat(value)) {
    return EMAIL_RULE_MESSAGE;
  }

  return undefined;
}
