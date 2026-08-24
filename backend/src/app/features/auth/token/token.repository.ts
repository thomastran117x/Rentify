import { BaseRepository } from "@/features/base/base.repository";
import { type AppRole, normalizeAppRole } from "@/features/auth/auth.model";

export class TokenRepository extends BaseRepository {
  async findSessionValidationByUserId(
    userId: string,
  ): Promise<{ tokenVersion: number; role: AppRole } | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          tokenVersion: true,
          role: true,
        },
      }),
    );

    if (!user) {
      return null;
    }

    return {
      tokenVersion: user.tokenVersion,
      role: normalizeAppRole(user.role),
    };
  }

  async findTokenVersionByUserId(userId: string): Promise<number | null> {
    const sessionValidation = await this.findSessionValidationByUserId(userId);
    return sessionValidation?.tokenVersion ?? null;
  }

  async rotateTokenVersion(userId: string): Promise<number> {
    const user = await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          tokenVersion: {
            increment: 1,
          },
        },
        select: {
          tokenVersion: true,
        },
      }),
    );

    return user.tokenVersion;
  }
}
