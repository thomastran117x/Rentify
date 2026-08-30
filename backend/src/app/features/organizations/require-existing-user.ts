import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import type { Uuid } from "@/configuration/validation/uuid";

/**
 * Loads the user behind an already-authenticated actor. The caller has a
 * valid session, so a missing row means the account was deleted out from
 * under it rather than a bad request.
 */
export async function requireExistingUser(
  authRepository: UsersRepository,
  userId: Uuid,
): Promise<AuthUserRecord> {
  const user = await authRepository.findUserById(userId);

  if (!user) {
    throw new ResourceNotFoundError("User account could not be found.");
  }

  return user;
}
