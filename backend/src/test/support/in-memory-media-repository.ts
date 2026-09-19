import type { Uuid } from "@/configuration/validation/uuid";
import type {
  CreateMediaRecordInput,
  MarkMediaReadyInput,
  MediaRecord,
  MediaStatus,
} from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";

/**
 * A MediaRepository with the same status-guarded transitions, held in memory,
 * for unit tests that exercise MediaService and the processing service without
 * a database. The real repository's SQL is covered by its own test.
 */
export class InMemoryMediaRepository {
  readonly rows = new Map<string, MediaRecord>();

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
      sizeBytes: null,
      width: null,
      height: null,
      rejectionReason: null,
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

  async markUploaded(id: Uuid, sizeBytes: number): Promise<boolean> {
    return this.transition(id, ["pending_upload"], {
      status: "uploaded",
      sizeBytes,
    });
  }

  async claimForProcessing(id: Uuid): Promise<boolean> {
    return this.transition(id, ["uploaded", "processing"], {
      status: "processing",
    });
  }

  async markReady(id: Uuid, input: MarkMediaReadyInput): Promise<boolean> {
    return this.transition(id, ["processing"], {
      status: "ready",
      ...input,
      rejectionReason: null,
    });
  }

  async markRejected(
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
