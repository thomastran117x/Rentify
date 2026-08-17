import { BaseRepository } from "@/features/base/base.repository";

export interface UsernamePage {
  usernames: string[];
  nextCursorId: string | null;
}

/**
 * Bulk read of claimed usernames, used only by the rebuild.
 *
 * Kept separate from `AuthRepository` because the access pattern is the
 * opposite one: that repository probes single names on the unique index,
 * whereas a rebuild walks the whole table and wants nothing but the column.
 */
export class UsernameBloomRepository extends BaseRepository {
  /**
   * Keyset pagination on the primary key rather than `skip`/`offset`, which
   * degrades badly deep into a large table because the database still has to
   * walk the rows it discards.
   */
  async listUsernamesAfter(
    cursorId: string | null,
    take: number,
  ): Promise<UsernamePage> {
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
      usernames: profiles.map((profile) => profile.username),
      // A short page means the table is exhausted; reporting no cursor stops
      // the walk without an extra empty round trip.
      nextCursorId: profiles.length < take ? null : (lastProfile?.id ?? null),
    };
  }
}
