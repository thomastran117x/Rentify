import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { isBcryptHash } from "@/features/auth/password-hashing";

export type LocalPasswordAuthUserRecord = AuthUserRecord & {
  passwordHash: string;
};

export function isLocalPasswordAccount(
  user: AuthUserRecord,
): user is LocalPasswordAuthUserRecord {
  return Boolean(user.passwordHash && isBcryptHash(user.passwordHash));
}

export function isEligibleForLocalPasswordManagement(
  user: AuthUserRecord,
): boolean {
  return user.emailVerified && isLocalPasswordAccount(user);
}

export function requireEligibleLocalPasswordUser(
  user: AuthUserRecord | null,
  defaultMessage: string,
): LocalPasswordAuthUserRecord {
  if (!user) {
    throw new BadRequestError(defaultMessage);
  }

  if (!isLocalPasswordAccount(user)) {
    throw new ConflictError(
      "This account uses a social sign-in provider. Use that provider to access your account.",
    );
  }

  if (!user.emailVerified) {
    throw new ConflictError(
      "Please verify your email address before managing your password.",
    );
  }

  return user;
}

/**
 * Inverse of {@link requireEligibleLocalPasswordUser}: accepts only accounts
 * that have no local password yet but do own a linked social identity, i.e.
 * the accounts that can add password sign-in alongside their provider.
 */
export function requirePasswordlessLinkedUser(
  user: AuthUserRecord | null,
): AuthUserRecord {
  if (!user) {
    throw new BadRequestError("This account cannot set a password.");
  }

  if (isLocalPasswordAccount(user)) {
    throw new ConflictError(
      "This account already has a password. Use the change password option instead.",
    );
  }

  if (!user.emailVerified) {
    throw new ConflictError(
      "Please verify your email address before managing your password.",
    );
  }

  if (user.oauthIdentities.length === 0) {
    throw new ConflictError("This account cannot set a password.");
  }

  return user;
}
