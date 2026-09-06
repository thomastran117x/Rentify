import { BaseRepository } from "@/features/base/base.repository";
import type {
  IdentityBloomSource,
  IdentityValuePage,
} from "@/features/auth/identity-bloom/sources/identity-bloom.source";

/**
 * Bulk read of claimed emails from `users`, used only by the rebuild.
 *
 * Emails live on the user row while usernames live on the profile, so this
 * walks a different table from {@link UsernameBloomSource} — the only thing
 * separating the two sources.
 */
export class EmailBloomSource
  extends BaseRepository
  implements IdentityBloomSource
{
  async listValuesAfter(
    cursorId: string | null,
    take: number,
  ): Promise<IdentityValuePage> {
    const users = await this.executeAsync(
      () =>
        this.prisma.user.findMany({
          ...(cursorId
            ? {
                cursor: { id: cursorId },
                skip: 1,
              }
            : {}),
          take,
          orderBy: { id: "asc" },
          select: {
            id: true,
            email: true,
          },
        }),
      { operationName: "listEmailsAfter" },
    );

    const lastUser = users.at(-1);

    return {
      values: users.map((user) => user.email),
      nextCursorId: users.length < take ? null : (lastUser?.id ?? null),
    };
  }
}
