import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";
import type { NewRecoveryCodeRow } from "./mfa-recovery-code.model";

export class MfaRecoveryCodeRepository extends BaseRepository {
  /**
   * Spends a code. The `usedAt: null` condition is what makes it single-use:
   * of any number of concurrent attempts, exactly one sees a count of 1.
   */
  async claim(userId: Uuid, codeHash: string, usedAt: Date): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.userMfaRecoveryCode.updateMany({
        where: { userId, codeHash, usedAt: null },
        data: { usedAt },
      }),
    );

    return result.count === 1;
  }

  async countUnused(userId: Uuid): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.userMfaRecoveryCode.count({
        where: { userId, usedAt: null },
      }),
    );
  }

  /** Every row of a set shares one `createdAt`; used rows count towards it. */
  async findSetCreatedAt(userId: Uuid): Promise<Date | null> {
    const row = await this.executeAsync(() =>
      this.prisma.userMfaRecoveryCode.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    );

    return row?.createdAt ?? null;
  }

  /**
   * Replaces the whole set, or does nothing and returns false when the account
   * has no active authenticator. The factor row is read `FOR UPDATE` so a
   * concurrent regeneration waits its turn and a concurrent disable cannot
   * leave codes behind on an account with no authenticator. Disable takes its
   * locks in this same order.
   */
  async replaceForActiveTotp(
    userId: Uuid,
    rows: NewRecoveryCodeRow[],
    createdAt: Date,
  ): Promise<boolean> {
    return this.executeTransaction(async (transaction) => {
      const factors = await transaction.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM user_mfa_totp
        WHERE user_id = ${userId} AND status = 'active'
        FOR UPDATE
      `;

      if (factors.length === 0) {
        return false;
      }

      await transaction.userMfaRecoveryCode.deleteMany({ where: { userId } });
      await transaction.userMfaRecoveryCode.createMany({
        data: rows.map((row) => ({ ...row, createdAt })),
      });

      return true;
    });
  }
}
