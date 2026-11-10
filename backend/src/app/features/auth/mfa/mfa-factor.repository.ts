import type { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";

type TransactionClient = Prisma.TransactionClient;

/**
 * Which second factors an account has. TOTP and passkeys are the strong
 * factors; recovery codes only stand in for them.
 */
export interface MfaFactorSummary {
  totpActive: boolean;
  passkeyCount: number;
  unusedRecoveryCodes: number;
}

export interface StrongFactors {
  totpActive: boolean;
  passkeyCount: number;
}

export function hasStrongFactor(factors: StrongFactors): boolean {
  return factors.totpActive || factors.passkeyCount > 0;
}

/**
 * Locks the account row for a change to its second factors or recovery codes.
 *
 * Every such change takes this lock first, then touches the factor tables,
 * then the codes. So two changes on one account run one after the other: an
 * authenticator being turned off while the last passkey is removed cannot
 * each see the other still there and both keep the codes.
 */
export async function lockAccountForMfaChange(
  transaction: TransactionClient,
  userId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT id FROM users WHERE id = ${userId} FOR UPDATE
  `;
}

export async function readStrongFactors(
  transaction: TransactionClient,
  userId: string,
): Promise<StrongFactors> {
  const [totp, passkeyCount] = await Promise.all([
    transaction.userMfaTotp.findFirst({
      where: { userId, status: "active" },
      select: { id: true },
    }),
    transaction.userWebAuthnCredential.count({ where: { userId } }),
  ]);

  return { totpActive: totp !== null, passkeyCount };
}

export class MfaFactorRepository extends BaseRepository {
  async getSummary(userId: Uuid): Promise<MfaFactorSummary> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          mfaTotp: { select: { status: true } },
          _count: {
            select: {
              webAuthnCredentials: true,
              mfaRecoveryCodes: { where: { usedAt: null } },
            },
          },
        },
      }),
    );

    return {
      totpActive: user?.mfaTotp?.status === "active",
      passkeyCount: user?._count.webAuthnCredentials ?? 0,
      unusedRecoveryCodes: user?._count.mfaRecoveryCodes ?? 0,
    };
  }
}
