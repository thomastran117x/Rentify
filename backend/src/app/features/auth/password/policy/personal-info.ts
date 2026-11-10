/** The account details a new password must not contain. */
export type PasswordPersonalContext = {
  username?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * Shorter tokens are skipped: a three-letter name such as "Lee" or "Kim"
 * appears inside too many ordinary words to reject on.
 */
export const MIN_PERSONAL_TOKEN_LENGTH = 4;

const SEPARATORS = /[\s._+-]+/u;

function compact(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokensOf(value: string | null | undefined): string[] {
  const lower = value?.trim().toLowerCase();

  if (!lower) {
    return [];
  }

  return [lower, compact(lower), ...lower.split(SEPARATORS)];
}

export function personalTokens(context: PasswordPersonalContext): string[] {
  const emailLocalPart = context.email?.split("@")[0];
  const tokens = [
    ...tokensOf(context.username),
    ...tokensOf(emailLocalPart),
    ...tokensOf(context.firstName),
    ...tokensOf(context.lastName),
  ].filter((token) => [...token].length >= MIN_PERSONAL_TOKEN_LENGTH);

  return [...new Set(tokens)];
}

/**
 * Whether the password contains the username, the email's local part or one of
 * its pieces, or the first or last name, ignoring case and separators, so
 * "Renter.One-2024" is caught for the username "renter-one".
 */
export function containsPersonalInfo(
  password: string,
  context: PasswordPersonalContext,
): boolean {
  const lower = password.toLowerCase();
  const haystacks = [lower, compact(lower)];

  return personalTokens(context).some((token) =>
    haystacks.some((haystack) => haystack.includes(token)),
  );
}
