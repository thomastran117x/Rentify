import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";

export class PasswordRepository extends BaseRepository {
  async updatePasswordHash(userId: Uuid, passwordHash: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash,
        },
      }),
    );
  }

  /**
   * Swaps in a rehash of the same password only while the stored hash is still
   * the one that was verified, so a password changed or reset in between is
   * never overwritten by the old one. Returns whether it was written.
   */
  async replacePasswordHashIfUnchanged(
    userId: Uuid,
    currentHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.user.updateMany({
        where: {
          id: userId,
          passwordHash: currentHash,
        },
        data: {
          passwordHash,
        },
      }),
    );

    return result.count === 1;
  }

  /**
   * Writes a first password only while the account still has none, so two
   * concurrent set-password requests cannot both succeed. Returns false when
   * another request won the race and the caller should report a conflict.
   */
  async setPasswordHashIfUnset(
    userId: Uuid,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.user.updateMany({
        where: {
          id: userId,
          passwordHash: null,
        },
        data: {
          passwordHash,
        },
      }),
    );

    return result.count === 1;
  }
}
