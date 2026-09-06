/**
 * Where a rebuild reads a subject's claimed values from.
 *
 * Kept separate from the feature repositories because the access pattern is the
 * opposite one: those probe single values on a unique index, whereas a rebuild
 * walks the whole table and wants nothing but the column.
 */

export interface IdentityValuePage {
  values: string[];
  nextCursorId: string | null;
}

export interface IdentityBloomSource {
  /**
   * One keyset page of claimed values, ordered by primary key. Returning a null
   * cursor ends the walk.
   */
  listValuesAfter(
    cursorId: string | null,
    take: number,
  ): Promise<IdentityValuePage>;
}
