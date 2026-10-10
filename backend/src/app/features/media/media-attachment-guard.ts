import { Prisma } from "@/generated/prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";

export interface ImageAttachmentChange {
  /** Every image name the write stores, whether new or resent unchanged. */
  attached: Iterable<string | null | undefined>;
  /** Image names the write stops storing. */
  released?: Iterable<string | null | undefined>;
}

interface LockedMediaRow {
  name: string;
  status: string;
}

/**
 * Keeps a write that stores image references in step with the media cleanup,
 * which deletes a ready item nothing references once it has not moved for its
 * TTL. Call it first inside the transaction that writes the references.
 *
 * It locks the media rows behind the names, refuses the write when one it
 * stores is no longer ready, and moves the `updated_at` of the rest to now.
 * The cleanup claims an item only while it is ready and unmoved, under the
 * same row lock, so either the write commits first and the claim finds the
 * item moved, or the claim does and the write fails here; a reference to a
 * deleted image is never stored. Moving a released image keeps it too, until
 * a restorable audit entry recorded after the write can hold it.
 *
 * A processed image always has a media row while it exists, so a write that
 * stores one whose row is gone is refused too: the image was deleted, by
 * DELETE /media/{id} or by a feature replacing it, and both delete the row
 * under the same lock before its blobs. Any other name with no row, such as a
 * legacy or seeded image, is left alone.
 */
export async function guardImageAttachments(
  transaction: Prisma.TransactionClient,
  change: ImageAttachmentChange,
  now: Date = new Date(),
): Promise<void> {
  const attached = normalizeNames(change.attached);
  const names = new Set([...attached, ...normalizeNames(change.released)]);

  if (names.size === 0) {
    return;
  }

  // A locking read, so a claim committed after this transaction's snapshot
  // was taken is still seen.
  const rows = await transaction.$queryRaw<LockedMediaRow[]>(Prisma.sql`
    SELECT processed_blob_name AS name, status
    FROM media
    WHERE processed_blob_name IN (${Prisma.join([...names])})
    FOR UPDATE
  `);

  const statuses = new Map(rows.map((row) => [row.name, row.status]));
  const unavailable = [...attached].some((name) => {
    const status = statuses.get(name);

    return status === undefined
      ? buildImageVariantBlobNames(name) !== null
      : status !== "ready";
  });

  if (unavailable) {
    throw new BadRequestError("Image is no longer available. Upload it again.");
  }

  // The rows are locked, so the statuses just read are still current.
  const ready = rows
    .filter((row) => row.status === "ready")
    .map((row) => row.name);

  if (ready.length > 0) {
    await transaction.media.updateMany({
      where: { processedBlobName: { in: ready } },
      data: { updatedAt: now },
    });
  }
}

function normalizeNames(
  names: Iterable<string | null | undefined> | undefined,
): Set<string> {
  const normalized = new Set<string>();

  for (const name of names ?? []) {
    const trimmed = name?.trim();

    if (trimmed) {
      normalized.add(trimmed);
    }
  }

  return normalized;
}
