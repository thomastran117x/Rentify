import type { Uuid } from "@/configuration/validation/uuid";
import type {
  CreateMediaRecordInput,
  MarkMediaReadyInput,
  MediaRecord,
  MediaRejectionCode,
  MediaScanRecord,
  MediaStatus,
  MediaVariantsMetadata,
} from "@/features/media/media.model";
import {
  describeProcessingError,
  scanResultColumns,
  type MediaRepository,
} from "@/features/media/media.repository";
import type { ModerationResult } from "@/features/media/moderation/image-moderation.service";

/**
 * A MediaRepository with the same status-guarded transitions, held in memory,
 * for unit tests that exercise MediaService and the processing service without
 * a database. The real repository's SQL is covered by its own test.
 */
export class InMemoryMediaRepository {
  readonly rows = new Map<string, MediaRecord>();
  /** Blob names a feature table references, for isBlobAttached. */
  readonly attachedBlobNames = new Set<string>();
  /** Ids a processing job reported progress on, in order. */
  readonly progressRecorded: string[] = [];

  asRepository(): MediaRepository {
    return this as unknown as MediaRepository;
  }

  async create(input: CreateMediaRecordInput): Promise<MediaRecord> {
    const now = new Date();
    const record: MediaRecord = {
      id: input.id,
      userId: input.userId,
      status: "pending_upload",
      scope: input.scope,
      originalBlobName: input.originalBlobName,
      processedBlobName: null,
      declaredContentType: input.declaredContentType,
      detectedContentType: null,
      originalFilename: input.originalFilename,
      originalEtag: null,
      sizeBytes: null,
      width: null,
      height: null,
      variants: null,
      rejectionReason: null,
      rejectionCode: null,
      processingRequeues: 0,
      processingAttempts: 0,
      processingStartedAt: null,
      processingCompletedAt: null,
      processingError: null,
      scanStatus: "not_scanned",
      scanEngine: null,
      scannedAt: null,
      threatName: null,
      moderationResult: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.set(record.id, record);
    return { ...record };
  }

  async findById(id: Uuid): Promise<MediaRecord | null> {
    const record = this.rows.get(id);
    return record ? { ...record } : null;
  }

  async findByOriginalBlobName(blobName: string): Promise<MediaRecord | null> {
    return this.find((record) => record.originalBlobName === blobName);
  }

  async findByProcessedBlobName(blobName: string): Promise<MediaRecord | null> {
    return this.find((record) => record.processedBlobName === blobName);
  }

  async markUploaded(
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

  async claimForProcessing(
    id: Uuid,
    expectedAttempts: number,
  ): Promise<boolean> {
    if (this.rows.get(id)?.processingAttempts !== expectedAttempts) {
      return false;
    }

    return this.transition(id, ["uploaded", "processing"], {
      status: "processing",
      processingAttempts: (this.rows.get(id)?.processingAttempts ?? 0) + 1,
      processingStartedAt: new Date(),
      scanStatus: "not_scanned",
      scanEngine: null,
      scannedAt: null,
      threatName: null,
      moderationResult: null,
    });
  }

  async recordScanResult(
    id: Uuid,
    attempt: number,
    scan: MediaScanRecord,
  ): Promise<boolean> {
    if (this.rows.get(id)?.processingAttempts !== attempt) {
      return false;
    }

    return this.transition(id, ["processing"], scanResultColumns(scan));
  }

  async recordModerationResult(
    id: Uuid,
    attempt: number,
    result: ModerationResult,
  ): Promise<boolean> {
    if (this.rows.get(id)?.processingAttempts !== attempt) {
      return false;
    }

    return this.transition(id, ["processing"], {
      moderationResult: structuredClone(result),
    });
  }

  async markReady(
    id: Uuid,
    attempt: number,
    input: MarkMediaReadyInput,
  ): Promise<boolean> {
    const row = this.rows.get(id);

    if (
      row?.processingAttempts !== attempt ||
      (row.scanStatus !== "clean" && row.scanStatus !== "skipped") ||
      row.moderationResult?.decision !== "allow"
    ) {
      return false;
    }

    return this.transition(id, ["processing"], {
      status: "ready",
      ...input,
      rejectionReason: null,
      rejectionCode: null,
      processingCompletedAt: new Date(),
    });
  }

  async recordProcessingFailure(id: Uuid, error: unknown): Promise<boolean> {
    return this.transition(id, ["uploaded", "processing"], {
      processingError: describeProcessingError(error),
    });
  }

  async markRejected(
    id: Uuid,
    rejectionReason: string,
    rejectionCode: MediaRejectionCode,
    detectedContentType?: string,
  ): Promise<boolean> {
    return this.transition(id, ["pending_upload", "uploaded", "processing"], {
      status: "rejected",
      rejectionReason: rejectionReason.slice(0, 500),
      rejectionCode,
      processingCompletedAt: new Date(),
      ...(detectedContentType ? { detectedContentType } : {}),
    });
  }

  async reopenForReplay(id: Uuid, rejectedAfter: Date): Promise<boolean> {
    const record = this.rows.get(id);

    if (
      record?.rejectionCode !== "processing_failed" ||
      record.updatedAt.getTime() <= rejectedAfter.getTime()
    ) {
      return false;
    }

    return this.transition(id, ["rejected"], {
      status: "uploaded",
      rejectionReason: null,
      rejectionCode: null,
      processingCompletedAt: null,
      processingRequeues: 0,
    });
  }

  async listReplayableRejections(
    rejectedAfter: Date,
    afterId: string | null,
    limit: number,
  ): Promise<MediaRecord[]> {
    return [...this.rows.values()]
      .filter(
        (record) =>
          record.status === "rejected" &&
          record.rejectionCode === "processing_failed" &&
          record.updatedAt.getTime() > rejectedAfter.getTime() &&
          (afterId === null || record.id > afterId),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async claimForReplay(
    id: Uuid,
    deadLetteredAt: Date,
    claimedAt: Date,
  ): Promise<boolean> {
    const record = this.rows.get(id);

    if (
      !record ||
      !["uploaded", "processing"].includes(record.status) ||
      record.updatedAt.getTime() > deadLetteredAt.getTime()
    ) {
      return false;
    }

    this.rows.set(id, { ...record, updatedAt: claimedAt });
    return true;
  }

  async recordProcessingProgress(id: Uuid): Promise<boolean> {
    this.progressRecorded.push(id);
    return this.transition(id, ["processing"], {});
  }

  async isBlobAttached(blobName: string): Promise<boolean> {
    return this.attachedBlobNames.has(blobName);
  }

  async listReadyWithoutVariants(
    afterId: string | null,
    limit: number,
  ): Promise<MediaRecord[]> {
    return [...this.rows.values()]
      .filter(
        (record) =>
          record.status === "ready" &&
          record.processedBlobName !== null &&
          record.variants === null &&
          (afterId === null || record.id > afterId),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async setVariants(
    id: Uuid,
    processedBlobName: string,
    variants: MediaVariantsMetadata,
  ): Promise<boolean> {
    const record = this.rows.get(id);

    if (
      !record ||
      record.status !== "ready" ||
      record.processedBlobName !== processedBlobName ||
      record.variants !== null
    ) {
      return false;
    }

    this.rows.set(id, { ...record, variants });
    return true;
  }

  async deleteById(id: Uuid): Promise<void> {
    this.rows.delete(id);
  }

  /** Test helper: puts a row into any state directly. */
  put(record: MediaRecord): void {
    this.rows.set(record.id, { ...record });
  }

  private find(
    predicate: (record: MediaRecord) => boolean,
  ): MediaRecord | null {
    const record = [...this.rows.values()].find(predicate);
    return record ? { ...record } : null;
  }

  private transition(
    id: Uuid,
    from: MediaStatus[],
    changes: Partial<MediaRecord>,
  ): boolean {
    const record = this.rows.get(id);

    if (!record || !from.includes(record.status)) {
      return false;
    }

    this.rows.set(id, { ...record, ...changes, updatedAt: new Date() });
    return true;
  }
}
