import type { UserWebAuthnCredential } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";
import { MAX_PASSKEYS_PER_USER, type NewPasskeyRow } from "./passkey.model";

export type { UserWebAuthnCredential };

export type PasskeyCreateResult =
  | { status: "created"; row: UserWebAuthnCredential }
  | { status: "limit_reached" };

/**
 * Every query is scoped by `userId`, so an id belonging to another account
 * reads as missing and can never be renamed, removed or used.
 */
export class PasskeyRepository extends BaseRepository {
  async listByUserId(userId: Uuid): Promise<UserWebAuthnCredential[]> {
    return this.executeAsync(() =>
      this.prisma.userWebAuthnCredential.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  }

  async countByUserId(userId: Uuid): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.userWebAuthnCredential.count({ where: { userId } }),
    );
  }

  async findForUser(
    userId: Uuid,
    id: string,
  ): Promise<UserWebAuthnCredential | null> {
    return this.executeAsync(() =>
      this.prisma.userWebAuthnCredential.findFirst({ where: { userId, id } }),
    );
  }

  async findByCredentialIdForUser(
    userId: Uuid,
    credentialId: Uint8Array<ArrayBuffer>,
  ): Promise<UserWebAuthnCredential | null> {
    return this.executeAsync(() =>
      this.prisma.userWebAuthnCredential.findFirst({
        where: { userId, credentialId },
      }),
    );
  }

  /**
   * Inserts the passkey unless the account already holds the most it may.
   * The user row is read `FOR UPDATE` first, so two registrations finishing
   * at once count one after the other and cannot both slip under the cap.
   *
   * A credential ID that is already registered, to any account, fails the
   * unique index; the caller reports it.
   */
  async createWithinCap(row: NewPasskeyRow): Promise<PasskeyCreateResult> {
    return this.executeTransaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id FROM users WHERE id = ${row.userId} FOR UPDATE
      `;

      const count = await transaction.userWebAuthnCredential.count({
        where: { userId: row.userId },
      });

      if (count >= MAX_PASSKEYS_PER_USER) {
        return { status: "limit_reached" };
      }

      const created = await transaction.userWebAuthnCredential.create({
        data: {
          id: row.id,
          userId: row.userId,
          credentialId: row.credentialId,
          publicKey: row.publicKey,
          signCount: BigInt(row.signCount),
          transports: row.transports,
          aaguid: row.aaguid,
          backedUp: row.backedUp,
          deviceType: row.deviceType,
          name: row.name,
        },
      });

      return { status: "created", row: created };
    });
  }

  async rename(
    userId: Uuid,
    id: string,
    name: string,
  ): Promise<UserWebAuthnCredential | null> {
    const result = await this.executeAsync(() =>
      this.prisma.userWebAuthnCredential.updateMany({
        where: { userId, id },
        data: { name },
      }),
    );

    return result.count === 1 ? this.findForUser(userId, id) : null;
  }

  /** Returns the row that was removed, or null when there was none. */
  async deleteForUser(
    userId: Uuid,
    id: string,
  ): Promise<UserWebAuthnCredential | null> {
    return this.executeTransaction(async (transaction) => {
      const row = await transaction.userWebAuthnCredential.findFirst({
        where: { userId, id },
      });

      if (!row) {
        return null;
      }

      const deleted = await transaction.userWebAuthnCredential.deleteMany({
        where: { userId, id },
      });

      return deleted.count === 1 ? row : null;
    });
  }

  /**
   * Records a use, but only if the stored counter is still the one the
   * assertion was checked against. The comparison and the write are one
   * statement, so of two assertions racing past the check exactly one wins.
   */
  async claimSignCount(input: {
    id: string;
    expectedSignCount: bigint;
    signCount: number;
    backedUp: boolean;
    usedAt: Date;
  }): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.userWebAuthnCredential.updateMany({
        where: { id: input.id, signCount: input.expectedSignCount },
        data: {
          signCount: BigInt(input.signCount),
          backedUp: input.backedUp,
          lastUsedAt: input.usedAt,
        },
      }),
    );

    return result.count === 1;
  }
}
