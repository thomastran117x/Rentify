import { Prisma, type Media } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import { toAuditSnapshotRecord } from "@/features/organizations/audit/audit.model";
import type {
  CreateMediaRecordInput,
  ImageRenditionInfo,
  MarkMediaReadyInput,
  MediaRecord,
  MediaRejectionCode,
  MediaScanRecord,
  MediaScanStatus,
  MediaStatus,
  MediaVariantsMetadata,
  RecordedRenditions,
} from "@/features/media/media.model";
import {
  MODERATION_CATEGORIES,
  type ModerationResult,
} from "@/features/media/moderation/image-moderation.service";

// Completed uploads that still wait on their processing job.
const STUCK_STATUSES: MediaStatus[] = ["uploaded", "processing"];

// The scan verdicts an item may become ready from: clean, or skipped because
// no scanner is configured.
const READY_SCAN_STATUSES: MediaScanStatus[] = ["clean", "skipped"];

// The scan_engine and threat_name columns' lengths.
const SCAN_ENGINE_MAX_LENGTH = 50;
const THREAT_NAME_MAX_LENGTH = 255;

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
   * Claims the item as attempt `expectedAttempts + 1`, only while
   * `processing_attempts` is still `expectedAttempts`, as the caller read it.
   * So of two jobs that read the same row only one claims it, and the winner
   * knows its attempt number, which its scan and markReady are then held to.
   *
   * Accepts a row already in `processing`: a worker that died mid-job leaves it
   * there, and the redelivered job must be able to pick it back up. Every
   * claim is counted, redeliveries included. The scan and the moderation
   * result are cleared, so each attempt must scan the bytes it downloaded, and
   * moderate the image it made from them, before it can mark the item ready.
   */
  claimForProcessing(id: Uuid, expectedAttempts: number): Promise<boolean> {
    return this.transition(
      id,
      ["uploaded", "processing"],
      {
        status: "processing",
        processingAttempts: { increment: 1 },
        processingStartedAt: new Date(),
        scanStatus: "not_scanned",
        scanEngine: null,
        scannedAt: null,
        threatName: null,
        moderationResult: Prisma.DbNull,
      },
      {
        where: { processingAttempts: expectedAttempts },
        operationName: "claimForProcessing",
      },
    );
  }

  /**
   * Records attempt `attempt`'s malware scan, only while that is still the
   * item's latest attempt, so an overtaken attempt cannot replace a later
   * one's verdict.
   */
  recordScanResult(
    id: Uuid,
    attempt: number,
    scan: MediaScanRecord,
  ): Promise<boolean> {
    return this.transition(id, ["processing"], scanResultColumns(scan), {
      where: { processingAttempts: attempt },
      operationName: "recordScanResult",
    });
  }

  /**
   * Records attempt `attempt`'s content moderation, only while that is still
   * the item's latest attempt, so an overtaken attempt cannot replace a later
   * one's result.
   */
  recordModerationResult(
    id: Uuid,
    attempt: number,
    result: ModerationResult,
  ): Promise<boolean> {
    return this.transition(
      id,
      ["processing"],
      { moderationResult: result as unknown as Prisma.InputJsonValue },
      {
        where: { processingAttempts: attempt },
        operationName: "recordModerationResult",
      },
    );
  }

  /**
   * Applies only while `attempt` is still the item's latest attempt, its scan
   * passed, and its moderation allowed it, so no path can publish an
   * unscanned, infected, unmoderated, or blocked upload, or publish on the
   * strength of another attempt's checks, whatever the caller does.
   */
  markReady(
    id: Uuid,
    attempt: number,
    input: MarkMediaReadyInput,
  ): Promise<boolean> {
    return this.transition(
      id,
      ["processing"],
      {
        status: "ready",
        processedBlobName: input.processedBlobName,
        detectedContentType: input.detectedContentType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        variants: input.variants as unknown as Prisma.InputJsonValue,
        rejectionReason: null,
        rejectionCode: null,
        processingCompletedAt: new Date(),
      },
      {
        where: {
          processingAttempts: attempt,
          scanStatus: { in: READY_SCAN_STATUSES },
          moderationResult: { path: "$.decision", equals: "allow" },
        },
        operationName: "markReady",
      },
    );
  }

  /**
   * Keeps the failure a processing job hit, for operators, while the item is
   * still unfinished. It is overwritten by the next failure and never leaves
   * the database through an API.
   */
  recordProcessingFailure(id: Uuid, error: unknown): Promise<boolean> {
    return this.transition(
      id,
      ["uploaded", "processing"],
      { processingError: describeProcessingError(error) },
      { operationName: "recordProcessingFailure" },
    );
  }

  markRejected(
    id: Uuid,
    rejectionReason: string,
    rejectionCode: MediaRejectionCode,
    detectedContentType?: string,
  ): Promise<boolean> {
    return this.transition(id, ["pending_upload", "uploaded", "processing"], {
      ...rejection(rejectionReason, rejectionCode),
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
   * Ready items unmoved since `updatedBefore` whose processed image no posting
   * photo, avatar, organization logo, or blog cover references, least recently
   * moved first. Attached items are left out by the query rather than by the
   * caller, so the many long-attached images cannot fill every batch.
   */
  async listUnattachedReady(
    updatedBefore: Date,
    limit: number,
  ): Promise<MediaRecord[]> {
    const ids = await this.executeAsync(
      () =>
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT m.id
          FROM media m
          WHERE m.status = 'ready'
            AND m.processed_blob_name IS NOT NULL
            AND m.updated_at < ${updatedBefore}
            AND NOT EXISTS (
              SELECT 1 FROM posting_photos p
              WHERE p.blob_name = m.processed_blob_name
            )
            AND NOT EXISTS (
              SELECT 1 FROM profiles p
              WHERE p.avatar_blob_name = m.processed_blob_name
            )
            AND NOT EXISTS (
              SELECT 1 FROM organizations o
              WHERE o.logo_blob_name = m.processed_blob_name
            )
            AND NOT EXISTS (
              SELECT 1 FROM organization_blog_posts b
              WHERE b.cover_image_blob_name = m.processed_blob_name
            )
          ORDER BY m.updated_at ASC
          LIMIT ${limit}
        `),
      { operationName: "listUnattachedReady" },
    );

    if (ids.length === 0) {
      return [];
    }

    return this.listForCleanup(
      { id: { in: ids.map((row) => row.id) } },
      { updatedAt: "asc" },
      limit,
      "listUnattachedReadyRows",
    );
  }

  /**
   * Which of `blobNames` a restorable audit entry still references: an
   * organization's logo, or a posting's photo, before or after the change it
   * records. Restoring that entry writes the reference back, so the image must
   * outlive it; such entries are never retired today.
   */
  async listAuditHeldBlobNames(blobNames: string[]): Promise<Set<string>> {
    if (blobNames.length === 0) {
      return new Set();
    }

    const candidates = JSON.stringify(blobNames);
    const rows = await this.executeAsync(
      () =>
        this.prisma.$queryRaw<
          Array<{ beforeSnapshot: unknown; afterSnapshot: unknown }>
        >(Prisma.sql`
          SELECT a.before_snapshot AS beforeSnapshot,
                 a.after_snapshot AS afterSnapshot
          FROM organization_audit_logs a
          WHERE a.restorable = TRUE
            AND a.resource_type IN ('organization', 'posting')
            AND (
              JSON_UNQUOTE(JSON_EXTRACT(a.before_snapshot, '$.logoBlobName'))
                IN (${Prisma.join(blobNames)})
              OR JSON_UNQUOTE(JSON_EXTRACT(a.after_snapshot, '$.logoBlobName'))
                IN (${Prisma.join(blobNames)})
              OR JSON_OVERLAPS(
                JSON_EXTRACT(a.before_snapshot, '$.photos[*].blobName'),
                CAST(${candidates} AS JSON)
              )
              OR JSON_OVERLAPS(
                JSON_EXTRACT(a.after_snapshot, '$.photos[*].blobName'),
                CAST(${candidates} AS JSON)
              )
            )
        `),
      { operationName: "listAuditHeldBlobNames" },
    );

    const wanted = new Set(blobNames);
    const held = new Set<string>();
    const add = (value: unknown): void => {
      if (typeof value === "string" && wanted.has(value)) {
        held.add(value);
      }
    };

    for (const row of rows) {
      for (const snapshot of [row.beforeSnapshot, row.afterSnapshot]) {
        const record = toAuditSnapshotRecord(parseJsonColumn(snapshot));
        add(record.logoBlobName);

        if (Array.isArray(record.photos)) {
          record.photos.forEach((photo) =>
            add(toAuditSnapshotRecord(photo).blobName),
          );
        }
      }
    }

    return held;
  }

  /**
   * Moves a ready item the cleanup must keep for now, such as one a restorable
   * audit entry references, to the back of the unattached order, so it cannot
   * hold up newer ones. It is looked at again once its TTL has passed anew.
   */
  deferUnattached(
    id: Uuid,
    updatedBefore: Date,
    deferredAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      ["ready"],
      { updatedAt: deferredAt },
      {
        where: { updatedAt: { lt: updatedBefore } },
        operationName: "deferUnattached",
      },
    );
  }

  /**
   * Rejects a ready item as `unattached`, only while it is still unmoved since
   * `updatedBefore`. This is the cleanup's claim on the row. A save that
   * attached the image after the cleanup read it moved `updated_at` in the
   * same transaction, so the claim fails and the image is kept; a save after
   * the claim finds the item rejected and stores nothing. See
   * guardImageAttachments.
   */
  claimUnattached(
    id: Uuid,
    updatedBefore: Date,
    rejectionReason: string,
    rejectedAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      ["ready"],
      {
        ...rejection(rejectionReason, "unattached", rejectedAt),
        updatedAt: rejectedAt,
      },
      {
        where: { updatedAt: { lt: updatedBefore } },
        operationName: "claimUnattached",
      },
    );
  }

  /**
   * Claims a stuck item for re-enqueueing: moves its `updatedAt` to `claimedAt`
   * and counts the re-queue. Applies only while the item is still waiting and
   * still unmoved since `updatedBefore`, so of several cleanup runs racing on
   * one item only one re-enqueues it, and the next sweep waits a whole
   * threshold again. Both times come from the caller's clock, so the claim and
   * the cutoff it is compared against agree.
   */
  claimStuckForRequeue(
    id: Uuid,
    updatedBefore: Date,
    claimedAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      STUCK_STATUSES,
      { updatedAt: claimedAt, processingRequeues: { increment: 1 } },
      {
        where: { updatedAt: { lt: updatedBefore } },
        operationName: "claimStuckForRequeue",
      },
    );
  }

  /**
   * Rejects a stuck item only while it is still unmoved since `updatedBefore`.
   * A job that claimed the row, or reported progress, after the cleanup read
   * it moves `updatedAt`, so an item being processed right now is left alone.
   */
  rejectStuck(
    id: Uuid,
    updatedBefore: Date,
    rejectionReason: string,
    rejectionCode: MediaRejectionCode,
    rejectedAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      STUCK_STATUSES,
      {
        ...rejection(rejectionReason, rejectionCode, rejectedAt),
        updatedAt: rejectedAt,
      },
      {
        where: { updatedAt: { lt: updatedBefore } },
        operationName: "rejectStuck",
      },
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
    rejectionCode: MediaRejectionCode,
    rejectedAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      ["pending_upload"],
      {
        ...rejection(rejectionReason, rejectionCode, rejectedAt),
        updatedAt: rejectedAt,
      },
      {
        where: { createdAt: { lt: createdBefore } },
        operationName: "rejectAbandonedUpload",
      },
    );
  }

  /**
   * Moves a rejected item the cleanup failed to purge to the back of the
   * purge order, so one that keeps failing cannot hold up newer ones. It is
   * tried again once its retention has passed a second time.
   */
  deferRejectedPurge(
    id: Uuid,
    updatedBefore: Date,
    deferredAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      ["rejected"],
      { updatedAt: deferredAt },
      {
        where: { updatedAt: { lt: updatedBefore } },
        operationName: "deferRejectedPurge",
      },
    );
  }

  /**
   * Returns an item rejected because processing kept failing to `uploaded`,
   * so a replayed job can claim it, with a fresh re-queue budget for the media
   * cleanup. Applies only while it is still rejected with `processing_failed`
   * and was rejected after `rejectedAfter`. The caller passes the start of the
   * rejected retention, so an item the cleanup may be purging right now is
   * never reopened. An item deleted, purged, or rejected for any other reason
   * meanwhile is left alone, and the caller learns it lost.
   */
  reopenForReplay(id: Uuid, rejectedAfter: Date): Promise<boolean> {
    return this.transition(
      id,
      ["rejected"],
      {
        status: "uploaded",
        rejectionReason: null,
        rejectionCode: null,
        processingCompletedAt: null,
        processingRequeues: 0,
      },
      {
        where: {
          rejectionCode: "processing_failed",
          updatedAt: { gt: rejectedAfter },
        },
        operationName: "reopenForReplay",
      },
    );
  }

  /**
   * Items rejected as `processing_failed` after `rejectedAfter`, in id order
   * after `afterId`, for a replay driven by the database rather than the
   * dead-letter queue.
   */
  async listReplayableRejections(
    rejectedAfter: Date,
    afterId: string | null,
    limit: number,
  ): Promise<MediaRecord[]> {
    const rows = await this.executeAsync(
      () =>
        this.prisma.media.findMany({
          where: {
            status: "rejected",
            rejectionCode: "processing_failed",
            updatedAt: { gt: rejectedAfter },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          orderBy: { id: "asc" },
          take: limit,
        }),
      { operationName: "listReplayableRejections" },
    );

    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Claims an unfinished item for a dead-letter replay: moves its `updatedAt`
   * to `claimedAt`, only while it has not moved since `deadLetteredAt`. The
   * first replay of the item's job wins. A second replay, a duplicate message,
   * a job the media cleanup queued again, or a worker that picked it up
   * meanwhile has moved it, and is left to finish.
   */
  claimForReplay(
    id: Uuid,
    deadLetteredAt: Date,
    claimedAt: Date,
  ): Promise<boolean> {
    return this.transition(
      id,
      STUCK_STATUSES,
      { updatedAt: claimedAt },
      {
        where: { updatedAt: { lte: deadLetteredAt } },
        operationName: "claimForReplay",
      },
    );
  }

  /**
   * Records that a job is still working on an item, so the media cleanup does
   * not take it for one whose job was lost. Called between processing stages.
   */
  recordProcessingProgress(id: Uuid): Promise<boolean> {
    return this.transition(
      id,
      ["processing"],
      { updatedAt: new Date() },
      { operationName: "recordProcessingProgress" },
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

  /**
   * Applies `data` only while the row is in one of the `from` states and, when
   * given, also matches `where`, and reports whether it applied.
   */
  private async transition(
    id: Uuid,
    from: MediaStatus[],
    data: Prisma.MediaUpdateManyMutationInput,
    options: { where?: Prisma.MediaWhereInput; operationName?: string } = {},
  ): Promise<boolean> {
    const result = await this.executeAsync(
      () =>
        this.prisma.media.updateMany({
          where: { id, status: { in: from }, ...options.where },
          data,
        }),
      { operationName: options.operationName ?? "transition" },
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
      rejectionCode: row.rejectionCode,
      processingRequeues: row.processingRequeues,
      processingAttempts: row.processingAttempts,
      processingStartedAt: row.processingStartedAt,
      processingCompletedAt: row.processingCompletedAt,
      processingError: row.processingError,
      scanStatus: row.scanStatus,
      scanEngine: row.scanEngine,
      scannedAt: row.scannedAt,
      threatName: row.threatName,
      moderationResult: parseModerationResult(row.moderationResult),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * A scan as it is stored: the engine and signature are cut to fit their
 * columns. Exported for the in-memory repository, so tests store what MySQL
 * would.
 */
export function scanResultColumns(
  scan: MediaScanRecord,
  scannedAt: Date = new Date(),
): Pick<MediaRecord, "scanStatus" | "scanEngine" | "scannedAt" | "threatName"> {
  return {
    scanStatus: scan.status,
    scanEngine: scan.engine.slice(0, SCAN_ENGINE_MAX_LENGTH),
    scannedAt,
    threatName: scan.threatName?.slice(0, THREAT_NAME_MAX_LENGTH) ?? null,
  };
}

/**
 * A JSON column as a raw query returns it: already parsed by some drivers, a
 * string by others.
 */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Every rejection, whoever records it, is stored the same way. */
function rejection(
  rejectionReason: string,
  rejectionCode: MediaRejectionCode,
  rejectedAt: Date = new Date(),
): Pick<
  Prisma.MediaUpdateManyMutationInput,
  "status" | "rejectionReason" | "rejectionCode" | "processingCompletedAt"
> {
  return {
    status: "rejected",
    rejectionReason: rejectionReason.slice(0, 500),
    rejectionCode,
    processingCompletedAt: rejectedAt,
  };
}

// The processing_error column's length.
const PROCESSING_ERROR_MAX_LENGTH = 1000;

/** The error's class and message, cut to fit the column. */
export function describeProcessingError(error: unknown): string {
  const description =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Non-error thrown: ${String(error)}`;

  return description.slice(0, PROCESSING_ERROR_MAX_LENGTH);
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

/**
 * Reads a stored moderation result back. Anything not in the shape the worker
 * writes counts as none; it is only ever read by operators.
 */
export function parseModerationResult(
  value: Prisma.JsonValue | null,
): ModerationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const { decision, provider, categories } = value;

  if (
    (decision !== "allow" && decision !== "block") ||
    typeof provider !== "string" ||
    !categories ||
    typeof categories !== "object" ||
    Array.isArray(categories)
  ) {
    return null;
  }

  const severities: ModerationResult["categories"] = {};

  for (const category of MODERATION_CATEGORIES) {
    const severity = categories[category];

    if (typeof severity === "number") {
      severities[category] = severity;
    }
  }

  return { decision, provider, categories: severities };
}
