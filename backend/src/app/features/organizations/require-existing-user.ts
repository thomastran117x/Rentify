import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { AuthRepository } from "@/features/auth/auth.repository";
import type { AuthUserRecord } from "@/features/auth/auth.model";

/**
 * Loads the user behind an already-authenticated actor. The caller has a
 * valid session, so a missing row means the account was deleted out from
 * under it rather than a bad request.
 */
export async function requireExistingUser(
  authRepository: AuthRepository,
  userId: string,
): Promise<AuthUserRecord> {
  const user = await authRepository.findUserById(userId);

  if (!user) {
    throw new ResourceNotFoundError("User account could not be found.");
  }

  return user;
}
