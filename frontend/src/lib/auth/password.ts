/**
 * Mirrors the backend `strongPasswordSchema` in
 * `backend/src/app/features/auth/auth.model.ts` and the shape rules in
 * `backend/src/app/features/auth/password/policy/password-rules.ts`, so the
 * forms reject a password the server would refuse before spending a request on
 * a guaranteed 400. Keep the two in sync -- including the unsafe-input rule,
 * which is easy to miss because it lives in a separate refine.
 *
 * Length is the rule: there are no character-class requirements.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
export const PASSWORD_TOO_LONG_MESSAGE = `Password must be at most ${PASSWORD_MAX_BYTES} bytes. Shorten it, or use fewer accented or special characters.`;

export const PERSONAL_INFO_PASSWORD_MESSAGE =
  "Password must not contain your name, username or email address.";

export const UNSAFE_AUTH_INPUT_MESSAGE =
  "Input contains unsupported HTML or script content.";

const UNSAFE_AUTH_INPUT_PATTERN =
  /<[^>]*>|&lt;|&gt;|javascript:|data:text\/html|on[a-z]+\s*=|<\/?script\b/i;

export function containsUnsafeAuthInput(value: string): boolean {
  return UNSAFE_AUTH_INPUT_PATTERN.test(value);
}

/** Counted in code points, as the backend does, so an emoji is one character. */
export function passwordLength(password: string): number {
  return [...password].length;
}

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

/**
 * The account details a new password must not contain. Mirrors
 * `backend/src/app/features/auth/password/policy/personal-info.ts`: the
 * username, the email's local part and its pieces, and the names, ignoring
 * case and separators, skipping anything shorter than four characters.
 */
export interface PasswordPersonalContext {
  username?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

const MIN_PERSONAL_TOKEN_LENGTH = 4;
const SEPARATORS = /[\s._+-]+/u;

function compact(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokensOf(value: string | null | undefined): string[] {
  const lower = value?.trim().toLowerCase();

  return lower ? [lower, compact(lower), ...lower.split(SEPARATORS)] : [];
}

export function personalTokens(context: PasswordPersonalContext): string[] {
  const tokens = [
    ...tokensOf(context.username),
    ...tokensOf(context.email?.split("@")[0]),
    ...tokensOf(context.firstName),
    ...tokensOf(context.lastName),
  ].filter((token) => [...token].length >= MIN_PERSONAL_TOKEN_LENGTH);

  return [...new Set(tokens)];
}

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

export interface PasswordRequirement {
  id: "length" | "personal";
  label: string;
  test: (password: string, context: PasswordPersonalContext) => boolean;
  /** Rows that only make sense once the form knows something about the user. */
  appliesTo?: (context: PasswordPersonalContext) => boolean;
}

/**
 * The rules a user works towards, one per checklist row. The byte cap and the
 * unsafe-input rule are deliberately absent: they are rejections, not
 * something to aim for, so they surface only as error messages. Whether a
 * password is common or breached needs the server; see `use-password-check`.
 */
export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => passwordLength(password) >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "personal",
    label: "Doesn't contain your name, username or email",
    // Nothing typed yet is not an achievement.
    test: (password, context) =>
      password.length > 0 && !containsPersonalInfo(password, context),
    appliesTo: (context) => personalTokens(context).length > 0,
  },
];

export function getApplicablePasswordRequirements(
  context: PasswordPersonalContext = {},
): readonly PasswordRequirement[] {
  return PASSWORD_REQUIREMENTS.filter(
    (requirement) => requirement.appliesTo?.(context) ?? true,
  );
}

/**
 * Returns the message the backend would return, or null when the password
 * passes. The order matches the backend: length, byte cap, unsafe input, then
 * the personal-information check the services run.
 */
export function getPasswordStrengthError(
  password: string,
  context: PasswordPersonalContext = {},
): string | null {
  if (passwordLength(password) < PASSWORD_MIN_LENGTH) {
    return PASSWORD_TOO_SHORT_MESSAGE;
  }

  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    return PASSWORD_TOO_LONG_MESSAGE;
  }

  if (containsUnsafeAuthInput(password)) {
    return UNSAFE_AUTH_INPUT_MESSAGE;
  }

  if (containsPersonalInfo(password, context)) {
    return PERSONAL_INFO_PASSWORD_MESSAGE;
  }

  return null;
}
