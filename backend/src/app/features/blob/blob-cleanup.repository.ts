import { BaseRepository } from "@/features/base/base.repository";
import { loadImageReferences } from "@/features/blob/image-references";
import { listImageVariantBlobNames } from "@/features/blob/image-variant-names";
import { toAuditSnapshotRecord } from "@/features/organizations/audit/audit.model";

/**
 * How many references each source held. A feature source counts the image
 * names it stores, so a posting photo with a crop counts twice.
 */
export interface BlobReferenceSourceCounts {
  profiles: number;
  organizations: number;
  blogPosts: number;
  postingPhotos: number;
  auditSnapshots: number;
  /** Quarantined uploads that media processing may still need. */
  mediaUploads: number;
}

export interface BlobReferenceSnapshot {
  blobNames: Set<string>;
  sourceCounts: BlobReferenceSourceCounts;
}

export class BlobCleanupRepository extends BaseRepository {
  async loadReferences(): Promise<BlobReferenceSnapshot> {
    return this.executeAsync(
      async () => {
        const [references, auditLogs, mediaUploads] = await Promise.all([
          loadImageReferences(this.prisma),
          this.prisma.organizationAuditLog.findMany({
            where: {
              resourceType: { in: ["organization", "posting"] },
              restorable: true,
            },
            select: {
              resourceType: true,
              beforeSnapshot: true,
              afterSnapshot: true,
            },
          }),
          // An upload still waiting on processing, or one a processing
          // failure keeps for a dead-letter replay. The media cleanup worker
          // decides when these go, whatever their age: an item can wait
          // longer than the grace period, and a replay needs its upload for
          // the whole rejected retention.
          this.prisma.media.findMany({
            where: {
              OR: [
                { status: { in: ["uploaded", "processing"] } },
                { status: "rejected", rejectionCode: "processing_failed" },
              ],
            },
            select: { originalBlobName: true },
          }),
        ]);

        const blobNames = new Set<string>();
        const add = (value: unknown): void => {
          if (typeof value !== "string") {
            return;
          }

          const normalized = value.trim();
          if (normalized) {
            blobNames.add(normalized);
          }

          // A processed image is served in three renditions, and a reference
          // to it keeps all of them.
          listImageVariantBlobNames(normalized).forEach((variant) =>
            blobNames.add(variant),
          );
        };

        const sourceCounts: BlobReferenceSourceCounts = {
          profiles: 0,
          organizations: 0,
          blogPosts: 0,
          postingPhotos: 0,
          auditSnapshots: auditLogs.length,
          mediaUploads: mediaUploads.length,
        };

        references.forEach((reference) => {
          add(reference.name);
          sourceCounts[reference.source] += 1;
        });
        mediaUploads.forEach((row) => add(row.originalBlobName));
        auditLogs.forEach((row) => {
          const snapshots = [row.beforeSnapshot, row.afterSnapshot];

          if (row.resourceType === "organization") {
            snapshots.forEach((snapshot) => {
              add(toAuditSnapshotRecord(snapshot).logoBlobName);
            });
            return;
          }

          snapshots.forEach((snapshot) => {
            const photos = toAuditSnapshotRecord(snapshot).photos;
            if (!Array.isArray(photos)) {
              return;
            }

            photos.forEach((photo) => {
              const photoRecord = toAuditSnapshotRecord(photo);
              add(photoRecord.blobName);
              add(photoRecord.thumbnailBlobName);
            });
          });
        });

        return { blobNames, sourceCounts };
      },
      { operationName: "loadReferences" },
    );
  }

  /**
   * Removes media rows the cleanup has left without an image:
   *
   * - a row that never reached `ready` whose quarantined upload it deleted;
   * - a row whose processed image it deleted, which it only does when nothing
   *   references that image.
   *
   * A ready row is never removed because its *quarantined* upload was deleted.
   * That upload is only a leftover the worker failed to clean up; the row's
   * processed image may still be attached.
   *
   * Rows are not removed for their age alone. The media cleanup worker owns
   * unfinished and rejected rows, and deletes them on its own schedule.
   */
  async deleteAbandonedMedia(input: {
    deletedBlobNames: string[];
  }): Promise<number> {
    const result = await this.executeAsync(
      () =>
        this.prisma.media.deleteMany({
          where: {
            OR: [
              {
                originalBlobName: { in: input.deletedBlobNames },
                status: { not: "ready" },
              },
              { processedBlobName: { in: input.deletedBlobNames } },
            ],
          },
        }),
      { operationName: "deleteAbandonedMedia" },
    );

    return result.count;
  }
}
