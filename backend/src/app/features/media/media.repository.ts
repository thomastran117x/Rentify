import { Prisma, type Media } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import type {
  CreateMediaRecordInput,
  ImageRenditionInfo,
  MarkMediaReadyInput,
  MediaRecord,
  MediaStatus,
  MediaVariantsMetadata,
  RecordedRenditions,
} from "@/features/media/media.model";

// Completed uploads that still wait on their processing job.
const STUCK_STATUSES: MediaStatus[] = ["uploaded", "processing"];

/**
 * Every state change is a conditional update guarded on the current status, so
 * two actors racing on one row (a retried job and its original, or a client
 * double-submitting "complete") cannot both win. Each transition reports
 * whether it applied; the caller decides what losing means.
 */
export class MediaRepository extends BaseRepository {
  async create(input: CreateMediaRecordInput): Promise<MediaRecord> {
    const row = await this.executeAsync(
      () =>
        this.prisma.media.create({
          data: {
            id: input.id,
            userId: input.userId,
            status: "pending_upload",
            scope: input.scope,
            originalBlobName: input.originalBlobName,
            declaredContentType: input.declaredContentType,
            originalFilename: input.originalFilename,
          },
        }),
      { operationName: "create" },
    );

    return this.toRecord(row);
  }

  async findById(id: Uuid): Promise<MediaRecord | null> {
    const row = await this.executeAsync(
      () => this.prisma.media.findUnique({ where: { id } }),
      { operationName: "findById" },
    );

    return row ? this.toRecord(row) : null;
  }

  async findByOriginalBlobName(blobName: string): Promise<MediaRecord | null> {
    const row = await this.executeAsync(
      () =>
        this.prisma.media.findUnique({ where: { originalBlobName: blobName } }),
      { operationName: "findByOriginalBlobName" },
    );

    return row ? this.toRecord(row) : null;
  }

  async findByProcessedBlobName(blobName: string): Promise<MediaRecord | null> {
    const row = await this.executeAsync(
      () =>
        this.prisma.media.findUnique({
          where: { processedBlobName: blobName },
        }),
      { operationName: "findByProcessedBlobName" },
    );

    return row ? this.toRecord(row) : null;
  }

  markUploaded(
    id: Uuid,
    sizeBytes: number,
    etag: string | null,
  ): Promise<boolean> {
    return this.transition(id, ["pending_upload"], {
      status: "uploaded",
      sizeBytes,
      originalEtag: etag,
    });
  }

  /**
   * Accepts a row already in `processing`: a worker that died mid-job leaves it
   * there, and the redelivered job must be able to pick it back up.
   */
  claimForProcessing(id: Uuid): Promise<boolean> {
    return this.transition(id, ["uploaded", "processing"], {
      status: "processing",
    });
  }

  markReady(id: Uuid, input: MarkMediaReadyInput): Promise<boolean> {
    return this.transition(id, ["processing"], {
      status: "ready",
      processedBlobName: input.processedBlobName,
      detectedContentType: input.detectedContentType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      variants: input.variants as unknown as Prisma.InputJsonValue,
      rejectionReason: null,
    });
  }

  markRejected(
    id: Uuid,
    rejectionReason: string,
    detectedContentType?: string,
  ): Promise<boolean> {
    return this.transition(id, ["pending_upload", "uploaded", "processing"], {
      status: "rejected",
      rejectionReason: rejectionReason.slice(0, 500),
      ...(detectedContentType ? { detectedContentType } : {}),
    });
  }

  /**
   * Whether a stored reference still points at this blob: a posting photo, an
   * avatar, an organization logo, or a blog cover.
   */
  async isBlobAttached(blobName: string): Promise<boolean> {
    const [photos, profiles, organizations, blogPosts] =
      await this.executeAsync(
        () =>
          Promise.all([
            this.prisma.postingPhoto.count({ where: { blobName } }),
            this.prisma.profile.count({ where: { avatarBlobName: blobName } }),
            this.prisma.organization.count({
              where: { logoBlobName: blobName },
            }),
            this.prisma.organizationBlogPost.count({
              where: { coverImageBlobName: blobName },
            }),
          ]),
        { operationName: "isBlobAttached" },
      );

    return photos + profiles + organizations + blogPosts > 0;
  }

  /**
   * The recorded renditions of ready media, keyed by processed blob name, for
   * ImageVariantsResolver. A name with no ready row is absent, so an image
   * whose media row is gone, or that is not a processed image, has none.
   */
  async findRecordedRenditions(
    processedBlobNames: string[],
  ): Promise<Map<string, RecordedRenditions>> {
    if (processedBlobNames.length === 0) {
      return new Map();
    }

    const rows = await this.executeAsync(
      () =>
        this.prisma.media.findMany({
          where: {
            status: "ready",
            processedBlobName: { in: processedBlobNames },
          },
          select: {
            processedBlobName: true,
            width: true,
            height: true,
            variants: true,
          },
        }),
      { operationName: "findRecordedRenditions" },
    );

    return new Map(
      rows.flatMap((row) =>
        row.processedBlobName
          ? [
              [
                row.processedBlobName,
                {
                  width: row.width,
                  height: row.height,
                  variants: parseMediaVariants(row.variants),
                },
              ] as const,
            ]
          : [],
      ),
    );
  }

  /**
   * Ready items processed before renditions existed, in id order after
   * `afterId`, for the backfill to page through.
   */
  async listReadyWithoutVariants(
    afterId: string | null,
    limit: number,
  ): Promise<MediaRecord[]> {
    const rows = await this.executeAsync(
      () =>
        this.prisma.media.findMany({
          where: {
            status: "ready",
            processedBlobName: { not: null },
            variants: { equals: Prisma.DbNull },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          orderBy: { id: "asc" },
          take: limit,
        }),
      { operationName: "listReadyWithoutVariants" },
    );

    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Records renditions the backfill wrote. Applies only while the item is
   * still ready with the same processed image and still has none recorded, so
   * a row deleted, re-processed, or backfilled by a concurrent run is left
   * alone and the caller learns it lost.
   */
  async setVariants(
    id: Uuid,
    processedBlobName: string,
    variants: MediaVariantsMetadata,
  ): Promise<boolean> {
    const result = await this.executeAsync(
      () =>
        this.prisma.media.updateMany({
          where: {
            id,
            status: "ready",
            processedBlobName,
            variants: { equals: Prisma.DbNull },
          },
          data: { variants: variants as unknown as Prisma.InputJsonValue },
        }),
      { operationName: "setVariants" },
    );

    return result.count > 0;
  }

  async deleteById(id: Uuid): Promise<void> {
    await this.executeAsync(
      () => this.prisma.media.deleteMany({ where: { id } }),
      { operationName: "deleteById" },
    );
  }

  /**
   * Uploads that were requested before `createdBefore` and never completed,
   * oldest first, for the media cleanup to delete.
   */
  listAbandonedUploads(
    createdBefore: Date,
    limit: number,
  ): Promise<MediaRecord[]> {
    return this.listForCleanup(
      {
        status: "pending_upload",
        createdAt: { lt: createdBefore },
      },
      { createdAt: "asc" },
      limit,
      "listAbandonedUploads",
    );
  }

  /**
   * Items waiting on a processing job that have not moved since
   * `updatedBefore`, least recently moved first: their job was most likely
   * lost.
   */
  listStuck(updatedBefore: Date, limit: number): Promise<MediaRecord[]> {
    return this.listForCleanup(
      {
        status: { in: STUCK_STATUSES },
        updatedAt: { lt: updatedBefore },
      },
      { updatedAt: "asc" },
      limit,
      "listStuck",
    );
  }

  /** Items rejected before `updatedBefore`, oldest first. */
  listRejected(updatedBefore: Date, limit: number): Promise<MediaRecord[]> {
    return this.listForCleanup(
      {
        status: "rejected",
        updatedAt: { lt: updatedBefore },
      },
      { updatedAt: "asc" },
      limit,
      "listRejected",
    );
  }

  /**
   * Claims a stuck item for re-enqueueing by moving its `updatedAt` to now.
   * Applies only while the item is still waiting and still unmoved since
   * `updatedBefore`, so of several cleanup runs racing on one item only one
   * re-enqueues it, and the next sweep waits a whole threshold again.
   */
  claimStuckForRequeue(id: Uuid, updatedBefore: Date): Promise<boolean> {
    return this.updateForCleanup(
      {
        id,
        status: { in: STUCK_STATUSES },
        updatedAt: { lt: updatedBefore },
      },
      { updatedAt: new Date() },
      "claimStuckForRequeue",
    );
  }

  /**
   * Rejects a stuck item only while it is still unmoved since `updatedBefore`.
   * A redelivered job that claimed the row after the cleanup read it moves
   * `updatedAt`, so an item being processed right now is left to finish.
   */
  rejectStuck(
    id: Uuid,
    updatedBefore: Date,
    rejectionReason: string,
  ): Promise<boolean> {
    return this.updateForCleanup(
      {
        id,
        status: { in: STUCK_STATUSES },
        updatedAt: { lt: updatedBefore },
      },
      { status: "rejected", rejectionReason },
      "rejectStuck",
    );
  }

  /**
   * Rejects an upload that was never completed, only while it is still
   * pending and was created before `createdBefore`. This is the cleanup's
   * claim on the row: once it applies, completing the upload can no longer
   * move it to `uploaded`, so its bytes can be deleted safely.
   */
  rejectAbandonedUpload(
    id: Uuid,
    createdBefore: Date,
    rejectionReason: string,
  ): Promise<boolean> {
    return this.updateForCleanup(
      {
        id,
        status: "pending_upload",
        createdAt: { lt: createdBefore },
      },
      { status: "rejected", rejectionReason },
      "rejectAbandonedUpload",
    );
  }

  /**
   * Deletes a row only while it is still in `status`, so an item that moved on
   * after the caller read it, such as an upload completed meanwhile, is kept.
   */
  async deleteByIdIfStatus(id: Uuid, status: MediaStatus): Promise<boolean> {
    const result = await this.executeAsync(
      () => this.prisma.media.deleteMany({ where: { id, status } }),
      { operationName: "deleteByIdIfStatus" },
    );

    return result.count > 0;
  }

  private async listForCleanup(
    where: Prisma.MediaWhereInput,
    orderBy: Prisma.MediaOrderByWithRelationInput,
    limit: number,
    operationName: string,
  ): Promise<MediaRecord[]> {
    const rows = await this.executeAsync(
      () => this.prisma.media.findMany({ where, orderBy, take: limit }),
      { operationName },
    );

    return rows.map((row) => this.toRecord(row));
  }

  private async updateForCleanup(
    where: Prisma.MediaWhereInput,
    data: Prisma.MediaUpdateManyMutationInput,
    operationName: string,
  ): Promise<boolean> {
    const result = await this.executeAsync(
      () => this.prisma.media.updateMany({ where, data }),
      { operationName },
    );

    return result.count > 0;
  }

  private async transition(
    id: Uuid,
    from: MediaStatus[],
    data: Prisma.MediaUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.executeAsync(
      () =>
        this.prisma.media.updateMany({
          where: { id, status: { in: from } },
          data,
        }),
      { operationName: "transition" },
    );

    return result.count > 0;
  }

  private toRecord(row: Media): MediaRecord {
    return {
      id: asUuid(row.id),
      userId: asUuid(row.userId),
      status: row.status,
      scope: row.scope,
      originalBlobName: row.originalBlobName,
      processedBlobName: row.processedBlobName,
      declaredContentType: row.declaredContentType,
      detectedContentType: row.detectedContentType,
      originalFilename: row.originalFilename,
      originalEtag: row.originalEtag,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      variants: parseMediaVariants(row.variants),
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function parseRenditionInfo(value: unknown): ImageRenditionInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const { width, height, sizeBytes } = value as Record<string, unknown>;

  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof sizeBytes !== "number"
  ) {
    return null;
  }

  return { width, height, sizeBytes };
}

/**
 * Reads the stored renditions back. Anything not in the shape the worker
 * writes counts as none. The backfill only selects rows whose column is SQL
 * NULL, so a malformed value is not rewritten by it; clear the column to have
 * the backfill write that row's renditions again.
 */
export function parseMediaVariants(
  value: Prisma.JsonValue | null,
): MediaVariantsMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  // Each key is present: a rendition's info, or null when it was not written
  // because the processed image is no wider than it.
  if (!("medium" in value) || !("thumbnail" in value)) {
    return null;
  }

  const medium =
    value.medium === null ? null : parseRenditionInfo(value.medium);
  const thumbnail =
    value.thumbnail === null ? null : parseRenditionInfo(value.thumbnail);

  if (
    (value.medium !== null && !medium) ||
    (value.thumbnail !== null && !thumbnail)
  ) {
    return null;
  }

  return { medium, thumbnail };
}
