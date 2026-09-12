import type { ManagedBlobItem } from "@/features/blob/blob.model";
import type { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";

export const ORPHANED_IMAGE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export interface BlobCleanupStorage {
  listAzureBlobs(): AsyncIterable<ManagedBlobItem>;
  deleteBlob(blobName: string): Promise<void>;
}

export interface BlobCleanupFailure {
  blobName: string;
  message: string;
}

export interface BlobCleanupCandidate {
  blobName: string;
  contentLength: number;
  lastModified: string;
}

export interface BlobCleanupResult {
  mode: "preview" | "delete";
  scanned: number;
  referenced: number;
  protected: number;
  candidateCount: number;
  candidates: BlobCleanupCandidate[];
  candidateBytes: number;
  deleted: number;
  deletedBytes: number;
  failed: number;
  failedBytes: number;
  failures: BlobCleanupFailure[];
}

export function blobCleanupExitCode(
  result: Pick<BlobCleanupResult, "failed">,
): 0 | 1 {
  return result.failed > 0 ? 1 : 0;
}

export class BlobCleanupService {
  constructor(
    private readonly repository: Pick<BlobCleanupRepository, "loadReferences">,
    private readonly storage: BlobCleanupStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(deleteCandidates: boolean): Promise<BlobCleanupResult> {
    let references = await this.repository.loadReferences();
    const inventory: ManagedBlobItem[] = [];

    for await (const blob of this.storage.listAzureBlobs()) {
      inventory.push(blob);
    }

    if (deleteCandidates) {
      references = await this.repository.loadReferences();
    }

    const cutoff = this.now().getTime() - ORPHANED_IMAGE_GRACE_PERIOD_MS;
    const candidates: BlobCleanupCandidate[] = [];
    let referenced = 0;
    let protectedCount = 0;

    for (const blob of inventory) {
      if (references.blobNames.has(blob.name)) {
        referenced += 1;
        continue;
      }

      const isImage =
        blob.contentType?.trim().toLowerCase().startsWith("image/") === true;
      const lastModifiedMs = blob.lastModified?.getTime();
      const isOldEnough =
        lastModifiedMs !== undefined &&
        Number.isFinite(lastModifiedMs) &&
        lastModifiedMs <= cutoff;

      if (!isImage || !isOldEnough || !blob.lastModified) {
        protectedCount += 1;
        continue;
      }

      candidates.push({
        blobName: blob.name,
        contentLength: this.normalizeContentLength(blob.contentLength),
        lastModified: blob.lastModified.toISOString(),
      });
    }

    const result: BlobCleanupResult = {
      mode: deleteCandidates ? "delete" : "preview",
      scanned: inventory.length,
      referenced,
      protected: protectedCount,
      candidateCount: candidates.length,
      candidates,
      candidateBytes: candidates.reduce(
        (total, candidate) => total + candidate.contentLength,
        0,
      ),
      deleted: 0,
      deletedBytes: 0,
      failed: 0,
      failedBytes: 0,
      failures: [],
    };

    if (!deleteCandidates) {
      return result;
    }

    for (const candidate of candidates) {
      try {
        await this.storage.deleteBlob(candidate.blobName);
        result.deleted += 1;
        result.deletedBytes += candidate.contentLength;
      } catch (error) {
        result.failed += 1;
        result.failedBytes += candidate.contentLength;
        result.failures.push({
          blobName: candidate.blobName,
          message: this.readErrorMessage(error),
        });
      }
    }

    return result;
  }

  private normalizeContentLength(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : 0;
  }

  private readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown deletion error.";
  }
}
