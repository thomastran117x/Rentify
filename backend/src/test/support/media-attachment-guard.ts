/**
 * The calls guardImageAttachments makes on a transaction, for repository tests
 * that fake one. `rows` are the media rows its locking read finds.
 */
export function createMediaGuardTransaction(
  rows: Array<{ name: string; status: string }> = [],
) {
  return {
    $queryRaw: jest.fn(async () => rows),
    media: {
      updateMany: jest.fn(async () => ({ count: rows.length })),
    },
  };
}
