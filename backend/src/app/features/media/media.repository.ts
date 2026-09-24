import type { Media, Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import type {
  CreateMediaRecordInput,
  ImageRenditionInfo,
  MarkMediaReadyInput,
  MediaRecord,
  MediaStatus,
  MediaVariantsMetadata,
} from "@/features/media/media.model";

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

  async deleteById(id: Uuid): Promise<void> {
    await this.executeAsync(
      () => this.prisma.media.deleteMany({ where: { id } }),
      { operationName: "deleteById" },
    );
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
 * writes counts as none, so a malformed row is backfilled again rather than
 * served with renditions that may not exist.
 */
export function parseMediaVariants(
  value: Prisma.JsonValue | null,
): MediaVariantsMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const medium = parseRenditionInfo(value.medium);
  const thumbnail = parseRenditionInfo(value.thumbnail);

  return medium && thumbnail ? { medium, thumbnail } : null;
}
