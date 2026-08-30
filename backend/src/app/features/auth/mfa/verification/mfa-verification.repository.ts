import { BaseRepository } from "@/features/base/base.repository";
import type { Uuid } from "@/configuration/validation/uuid";
import { asUuid } from "@/configuration/validation/uuid";

export type MfaVerificationSecurityContext = {
  id: Uuid;
  email: string;
  firstName?: string;
  emailVerified: boolean;
  tokenVersion: number;
  updatedAt: string;
  mfaTotp: {
    status: string;
    updatedAt: string;
    confirmedAt?: string;
  } | null;
};

export class MfaVerificationRepository extends BaseRepository {
  async findMfaVerificationSecurityContextByUserId(
    userId: Uuid,
  ): Promise<MfaVerificationSecurityContext | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          emailVerified: true,
          tokenVersion: true,
          updatedAt: true,
          mfaTotp: {
            select: {
              status: true,
              updatedAt: true,
              confirmedAt: true,
            },
          },
        },
      }),
    );

    if (!user) {
      return null;
    }

    return {
      id: asUuid(user.id),
      email: user.email,
      firstName: user.firstName ?? undefined,
      emailVerified: user.emailVerified,
      tokenVersion: user.tokenVersion,
      updatedAt: user.updatedAt.toISOString(),
      mfaTotp: user.mfaTotp
        ? {
            status: user.mfaTotp.status,
            updatedAt: user.mfaTotp.updatedAt.toISOString(),
            confirmedAt: user.mfaTotp.confirmedAt?.toISOString(),
          }
        : null,
    };
  }
}
