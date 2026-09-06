import { BaseRepository } from "@/features/base/base.repository";
import type {
  IdentityBloomSource,
  IdentityValuePage,
} from "@/features/auth/identity-bloom/sources/identity-bloom.source";

/** Bulk read of claimed usernames from `profiles`, used only by the rebuild. */
export class UsernameBloomSource
  extends BaseRepository
  implements IdentityBloomSource
{
  /**
   * Keyset pagination on the primary key rather than `skip`/`offset`, which
   * degrades badly deep into a large table because the database still has to
   * walk the rows it discards.
   */
  async listValuesAfter(
    cursorId: string | null,
    take: number,
  ): Promise<IdentityValuePage> {
    const profiles = await this.executeAsync(
      () =>
        this.prisma.profile.findMany({
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
            username: true,
          },
        }),
      { operationName: "listUsernamesAfter" },
    );

    const lastProfile = profiles.at(-1);

    return {
      values: profiles.map((profile) => profile.username),
      // A short page means the table is exhausted; reporting no cursor stops
      // the walk without an extra empty round trip.
      nextCursorId: profiles.length < take ? null : (lastProfile?.id ?? null),
    };
  }
}
