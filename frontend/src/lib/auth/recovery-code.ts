const RECOVERY_CODE_LENGTH = 10;

function recoveryCodeCharacters(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, RECOVERY_CODE_LENGTH);
}

/**
 * What a recovery code field shows as someone types or pastes: upper case, with
 * the hyphen in place. The server forgives case and separators too; this only
 * keeps the field readable and sized right.
 */
export function formatRecoveryCodeInput(value: string): string {
  const characters = recoveryCodeCharacters(value);
  const middle = RECOVERY_CODE_LENGTH / 2;

  return characters.length > middle
    ? `${characters.slice(0, middle)}-${characters.slice(middle)}`
    : characters;
}

export function isCompleteRecoveryCode(value: string): boolean {
  return recoveryCodeCharacters(value).length === RECOVERY_CODE_LENGTH;
}
