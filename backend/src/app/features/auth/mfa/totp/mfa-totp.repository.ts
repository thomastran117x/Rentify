import { randomUUID } from "node:crypto";
import type { UserMfaTotp } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";

export type { UserMfaTotp };

export class MfaTotpRepository extends BaseRepository {
  async findByUserId(userId: string): Promise<UserMfaTotp | null> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.findUnique({ where: { userId } }),
    );
  }

  async createPending(data: {
    userId: string;
    secretEncrypted: string;
    expiresAt: Date;
  }): Promise<UserMfaTotp> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.create({
        data: {
          id: randomUUID(),
          userId: data.userId,
          secretEncrypted: data.secretEncrypted,
          status: "pending",
          expiresAt: data.expiresAt,
        },
      }),
    );
  }

  async replacePending(
    id: string,
    data: { secretEncrypted: string; expiresAt: Date },
  ): Promise<UserMfaTotp> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.update({
        where: { id },
        data: {
          secretEncrypted: data.secretEncrypted,
          expiresAt: data.expiresAt,
          confirmedAt: null,
        },
      }),
    );
  }

  async activate(id: string, confirmedAt: Date): Promise<UserMfaTotp> {
    return this.executeAsync(() =>
      this.prisma.userMfaTotp.update({
        where: { id },
        data: {
          status: "active",
          confirmedAt,
          expiresAt: null,
        },
      }),
    );
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.userMfaTotp.deleteMany({ where: { userId } }),
    );
  }
}
