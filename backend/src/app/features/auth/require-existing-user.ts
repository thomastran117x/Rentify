import BadRequestError from "@/errors/http/bad-request.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { AuthUserRecord } from "@/features/auth/auth.model";

/**
 * Loads the user behind an authenticated principal. The token can outlive the
 * row it points at, so a missing user is a bad request rather than an internal
 * error.
 */
export async function requireExistingUser(
  authRepository: UsersRepository,
  userId: string,
): Promise<AuthUserRecord> {
  const user = await authRepository.findUserById(userId);

  if (!user) {
    throw new BadRequestError("User account could not be found.");
  }

  return user;
}
