import type { UserMfaTotp } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { newUuid, type Uuid } from "@/configuration/validation/uuid";

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

  async activate(
    id: string,
    confirmedAt: Date,
    lastUsedCounter: number,
  ): Promise<UserMfaTotp> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.update({
        where: { id },
        data: {
          status: "active",
          confirmedAt,
          expiresAt: null,
          lastUsedCounter: BigInt(lastUsedCounter),
        },
      }),
    );
  }

  async updateLastUsedCounter(id: string, counter: number): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.userMfaTotp.update({
        where: { id },
        data: { lastUsedCounter: BigInt(counter) },
      }),
    );
  }

  async deleteByUserId(userId: Uuid): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.userMfaTotp.deleteMany({ where: { userId } }),
    );
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
