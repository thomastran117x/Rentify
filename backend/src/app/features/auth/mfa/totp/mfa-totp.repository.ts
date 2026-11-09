import type { UserMfaTotp } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { newUuid, type Uuid } from "@/configuration/validation/uuid";
import type { NewRecoveryCodeRow } from "@/features/auth/mfa/recovery/mfa-recovery-code.model";

export type { UserMfaTotp };

export class MfaTotpRepository extends BaseRepository {
  async findByUserId(userId: Uuid): Promise<UserMfaTotp | null> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.findUnique({ where: { userId } }),
    );
  }

  async createPending(data: {
    userId: Uuid;
    secretEncrypted: string;
    expiresAt: Date;
  }): Promise<UserMfaTotp> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.create({
        data: {
          id: newUuid(),
          userId: data.userId,
          secretEncrypted: data.secretEncrypted,
          status: "pending",
          expiresAt: data.expiresAt,
        },
      }),
    );
  }

  // Updates a pending record's secret and expiry. The expectedUpdatedAt version
  // check ensures two concurrent re-enrollments can't both succeed — the second
  // writer sees count=0 (the first writer already changed updatedAt) and the
  // caller must retry beginEnrollment.
  async replacePending(
    id: string,
    data: { secretEncrypted: string; expiresAt: Date },
    expectedUpdatedAt: Date,
  ): Promise<number> {
    const result = await this.executeAsync(() =>
      this.prisma.userMfaTotp.updateMany({
        where: { id, status: "pending", updatedAt: expectedUpdatedAt },
        data: {
          secretEncrypted: data.secretEncrypted,
          status: "pending",
          expiresAt: data.expiresAt,
          confirmedAt: null,
        },
      }),
    );
    return result.count;
  }

  /**
   * Turns the factor on together with its recovery codes, so an authenticator
   * can never be active with codes nobody was shown. Conditional on the record
   * still being pending: false means a concurrent confirmation got there first
   * and these codes were not stored.
   */
  async activate(
    id: string,
    confirmedAt: Date,
    lastUsedCounter: number,
    recoveryCodes: NewRecoveryCodeRow[],
  ): Promise<boolean> {
    return this.executeTransaction(async (transaction) => {
      const activated = await transaction.userMfaTotp.updateMany({
        where: { id, status: "pending" },
        data: {
          status: "active",
          confirmedAt,
          expiresAt: null,
          lastUsedCounter: BigInt(lastUsedCounter),
        },
      });

      if (activated.count !== 1) {
        return false;
      }

      await transaction.userMfaRecoveryCode.createMany({
        data: recoveryCodes.map((row) => ({ ...row, createdAt: confirmedAt })),
      });

      return true;
    });
  }

  /**
   * Records `counter` as used, only if it is newer than the last one. The
   * comparison and the write are one statement, so of two requests racing
   * with the same code exactly one gets true.
   */
  async claimCounter(id: string, counter: number): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.userMfaTotp.updateMany({
        where: {
          id,
          status: "active",
          OR: [
            { lastUsedCounter: null },
            { lastUsedCounter: { lt: BigInt(counter) } },
          ],
        },
        data: { lastUsedCounter: BigInt(counter) },
      }),
    );

    return result.count === 1;
  }

  /**
   * Recovery codes only mean anything alongside an authenticator, so they go
   * with it. The factor row goes first, the lock order regeneration uses.
   */
  async deleteByUserId(userId: Uuid): Promise<void> {
    await this.executeTransaction(async (transaction) => {
      await transaction.userMfaTotp.deleteMany({ where: { userId } });
      await transaction.userMfaRecoveryCode.deleteMany({ where: { userId } });
    });
  }

  // Deletes only a pending record — leaves an active record untouched.
  async deleteByUserIdIfPending(userId: Uuid): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.userMfaTotp.deleteMany({
        where: { userId, status: "pending" },
      }),
    );
  }
}
