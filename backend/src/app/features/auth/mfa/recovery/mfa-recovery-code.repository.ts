import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";
import {
  hasStrongFactor,
  lockAccountForMfaChange,
  readStrongFactors,
} from "@/features/auth/mfa/mfa-factor.repository";
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
   * has no strong factor (an active authenticator or a passkey). The account
   * row is locked first, as every factor change does, so a concurrent
   * regeneration waits its turn and a concurrent removal of the last factor
   * cannot leave codes behind.
   */
  async replaceForStrongFactor(
    userId: Uuid,
    rows: NewRecoveryCodeRow[],
    createdAt: Date,
  ): Promise<boolean> {
    return this.executeTransaction(async (transaction) => {
      await lockAccountForMfaChange(transaction, userId);

      if (!hasStrongFactor(await readStrongFactors(transaction, userId))) {
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
