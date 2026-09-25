import { environment } from "@/configuration/environment/index";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BlobService } from "@/features/blob/blob.service";
import { SMALLER_IMAGE_VARIANTS } from "@/features/blob/image-variant-names";
import {
  renderSmallerRenditions,
  uploadSmallerRenditions,
} from "@/features/media/image-renditions";
import type { MediaRecord } from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";

export const DEFAULT_BACKFILL_BATCH_SIZE = 50;

export interface MediaVariantsBackfillItem {
  mediaId: string;
  processedBlobName: string;
}

export interface MediaVariantsBackfillFailure
  extends MediaVariantsBackfillItem {
  message: string;
}

export interface MediaVariantsBackfillResult {
  mode: "dry-run" | "backfill";
  /** Ready items found without renditions. */
  scanned: number;
  /** Items whose renditions were written and recorded. */
  converted: number;
  /**
   * Items that changed while they were being converted: deleted, re-processed,
   * or converted by a concurrent run. Nothing is recorded for them.
   */
  skipped: number;
  failed: number;
  failures: MediaVariantsBackfillFailure[];
  /** What a run without --dry-run would convert. Empty otherwise. */
  pending: MediaVariantsBackfillItem[];
}

export function mediaVariantsBackfillExitCode(
  result: Pick<MediaVariantsBackfillResult, "failed">,
): 0 | 1 {
  return result.failed > 0 ? 1 : 0;
}

/**
 * Writes the medium and thumbnail renditions of images processed before the
 * worker produced them, from their stored processed image, and records them on
 * the media row.
 *
 * Safe to re-run: it only selects ready rows with no renditions recorded, an
 * upload overwrites a rendition left by an interrupted run, and the row is
 * only updated while it still describes the same image. One item's failure is
 * reported and the run continues.
 */
export class MediaVariantsBackfillService {
  constructor(
    private readonly repository: Pick<
      MediaRepository,
      "listReadyWithoutVariants" | "setVariants" | "findById"
    >,
    private readonly blobService: Pick<
      BlobService,
      | "buildImageVariantBlobNames"
      | "downloadBlob"
      | "uploadBuffer"
      | "deleteBlob"
    >,
  ) {}

  async run(options: {
    dryRun: boolean;
    batchSize?: number;
  }): Promise<MediaVariantsBackfillResult> {
    const batchSize = options.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE;
    const result: MediaVariantsBackfillResult = {
      mode: options.dryRun ? "dry-run" : "backfill",
      scanned: 0,
      converted: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      pending: [],
    };
    // Paged by id rather than re-querying from the start, so an item that
    // fails is not selected again within the same run.
    let afterId: string | null = null;

    for (;;) {
      const batch = await this.repository.listReadyWithoutVariants(
        afterId,
        batchSize,
      );

      if (batch.length === 0) {
        break;
      }

      for (const record of batch) {
        afterId = record.id;
        result.scanned += 1;
        const item = {
          mediaId: record.id,
          processedBlobName: record.processedBlobName ?? "",
        };

        if (options.dryRun) {
          result.pending.push(item);
          continue;
        }

        try {
          if (await this.convert(record)) {
            result.converted += 1;
          } else {
            result.skipped += 1;
          }
        } catch (error) {
          result.failed += 1;
          result.failures.push({ ...item, message: describeFailure(error) });
        }
      }
    }

    return result;
  }

  /** Returns false when the item changed underneath the conversion. */
  private async convert(record: MediaRecord): Promise<boolean> {
    const names = record.processedBlobName
      ? this.blobService.buildImageVariantBlobNames(record.processedBlobName)
      : null;

    if (!names) {
      throw new Error("The processed image name has no renditions.");
    }

    // The processed image is this application's own output, already upright
    // and within the processed cap; the size limit only guards a damaged blob.
    const { body } = await this.blobService.downloadBlob(names.large, {
      maxBytes: environment.getImageUploadsConfig().maxSizeBytes,
    });
    const renditions = await renderSmallerRenditions(body);
    const variants = await uploadSmallerRenditions(
      this.blobService,
      names,
      renditions,
    );

    if (await this.repository.setVariants(record.id, names.large, variants)) {
      return true;
    }

    const current = await this.repository.findById(record.id);

    // A concurrent run recorded the same renditions; they are in use.
    if (
      current?.status === "ready" &&
      current.processedBlobName === names.large
    ) {
      return false;
    }

    // The item was deleted, so nothing will ever reference what was written.
    // Only the renditions: the processed image is not this run's to delete.
    await Promise.all(
      SMALLER_IMAGE_VARIANTS.map((variant) =>
        this.blobService.deleteBlob(names[variant]),
      ),
    );
    return false;
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof ResourceNotFoundError) {
    return "The processed image could not be found.";
  }

  return error instanceof Error ? error.message : "Unknown backfill error.";
}
