/**
 * The username rule, in one place.
 *
 * This mirrors `usernameSchema` in the backend
 * (`backend/src/app/features/profile/profile.model.ts`). The two have to be
 * changed together — there is no shared package between the workspaces, and no
 * zod on the frontend.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/i;

export const USERNAME_REQUIRED_MESSAGE = "Username is required.";
export const USERNAME_RULE_MESSAGE =
  "Use 3-50 letters, numbers, periods, underscores, or hyphens.";

/** Matches the backend's `.trim().toLowerCase()` normalization. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function hasValidUsernameFormat(value: string): boolean {
  const normalized = value.trim();

  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
  );
}

/** Returns the error message for an invalid username, or undefined when it is valid. */
export function validateUsernameFormat(value: string): string | undefined {
  if (!value.trim()) {
    return USERNAME_REQUIRED_MESSAGE;
  }

  if (!hasValidUsernameFormat(value)) {
    return USERNAME_RULE_MESSAGE;
  }

  return undefined;
}
