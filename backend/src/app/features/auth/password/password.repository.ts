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
