import type { UserWebAuthnCredential } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";
import {
  hasStrongFactor,
  lockAccountForMfaChange,
  readStrongFactors,
} from "@/features/auth/mfa/mfa-factor.repository";
import type { NewRecoveryCodeRow } from "@/features/auth/mfa/recovery/mfa-recovery-code.model";
import { MAX_PASSKEYS_PER_USER, type NewPasskeyRow } from "./passkey.model";

export type { UserWebAuthnCredential };

export type PasskeyCreateResult =
  | {
      status: "created";
      row: UserWebAuthnCredential;
      /** Whether `recoveryCodes` were stored, because the account had none. */
      recoveryCodesIssued: boolean;
    }
  | { status: "limit_reached" };

export interface PasskeyDeleteResult {
  row: UserWebAuthnCredential;
  /** No passkey and no authenticator is left, so the codes went too. */
  lastStrongFactor: boolean;
}

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
   * The account row is locked first (see {@link lockAccountForMfaChange}), so
   * two registrations finishing at once count one after the other and cannot
   * both slip under the cap.
   *
   * `recoveryCodes` are stored with it when the account has never had a set,
   * so a strong factor is never active with codes nobody was shown. An
   * account that already has a set, used up or not, keeps it.
   *
   * A credential ID that is already registered, to any account, fails the
   * unique index; the caller reports it.
   */
  async createWithinCap(
    row: NewPasskeyRow,
    recoveryCodes: NewRecoveryCodeRow[],
  ): Promise<PasskeyCreateResult> {
    return this.executeTransaction(async (transaction) => {
      await lockAccountForMfaChange(transaction, row.userId);

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
      const existingCodes = await transaction.userMfaRecoveryCode.count({
        where: { userId: row.userId },
      });

      if (existingCodes === 0) {
        await transaction.userMfaRecoveryCode.createMany({
          data: recoveryCodes.map((code) => ({
            ...code,
            createdAt: created.createdAt,
          })),
        });
      }

      return {
        status: "created",
        row: created,
        recoveryCodesIssued: existingCodes === 0,
      };
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

  /**
   * Removes the passkey, and the recovery codes with it when it was the
   * account's last strong factor: codes only ever stand in for one. Returns
   * null when there was nothing to remove.
   */
  async deleteForUser(
    userId: Uuid,
    id: string,
  ): Promise<PasskeyDeleteResult | null> {
    return this.executeTransaction(async (transaction) => {
      await lockAccountForMfaChange(transaction, userId);

      const row = await transaction.userWebAuthnCredential.findFirst({
        where: { userId, id },
      });

      if (!row) {
        return null;
      }

      await transaction.userWebAuthnCredential.deleteMany({
        where: { userId, id },
      });

      const lastStrongFactor = !hasStrongFactor(
        await readStrongFactors(transaction, userId),
      );

      if (lastStrongFactor) {
        await transaction.userMfaRecoveryCode.deleteMany({ where: { userId } });
      }

      return { row, lastStrongFactor };
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
