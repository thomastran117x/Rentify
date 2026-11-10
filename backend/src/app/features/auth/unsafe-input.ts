/**
 * The markup guard shared by auth request fields and new passwords. It lives on
 * its own so the password rules can use it without importing `auth.model`,
 * which imports them.
 */
export const UNSAFE_AUTH_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";
const UNSAFE_AUTH_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

export function containsUnsafeAuthInput(value: string): boolean {
  return UNSAFE_AUTH_INPUT_PATTERN.test(value);
}
