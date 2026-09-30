import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import type { Uuid } from "@/configuration/validation/uuid";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import BlobChangedError from "@/errors/blob-changed.error";
import type { BlobService } from "@/features/blob/blob.service";
import { listImageVariantBlobNames } from "@/features/blob/image-variant-names";
import type { BlobProperties } from "@/features/blob/blob.model";
import type { SupportedImageContentType } from "@/configuration/environment/constants";
import {
  assertImageBytes,
  assertImageNotEmpty,
  assertImageSizeWithinLimit,
  describeImageSizeLimit,
  IMAGE_DECODE_FAIL_ON,
  isImagePolicyRejection,
  normalizeImageContentType,
  rejectionCodeOf,
} from "@/features/media/image-policy";
import {
  deleteQuarantinedUpload,
  PROCESSING_FAILED_REASON,
  rejectMedia,
} from "@/features/media/media-rejection";
import {
  PROCESSED_IMAGE_CONTENT_TYPE,
  renderImage,
  renderSmallerRenditions,
  uploadSmallerRenditions,
} from "@/features/media/image-renditions";
import type {
  MediaMetrics,
  MediaProcessingOutcome,
} from "@/features/media/media-metrics";
import type {
  MediaRecord,
  MediaRejectionCode,
} from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";
import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";

/** A final refusal: why, in words and as a code. */
interface MediaRejection {
  reason: string;
  code: MediaRejectionCode;
}

const MISSING_UPLOAD: MediaRejection = {
  reason: "The uploaded file could not be found.",
  code: "missing_upload",
};
const UPLOAD_CHANGED: MediaRejection = {
  reason: "The upload changed after it was completed.",
  code: "upload_changed",
};

// The scope a duration is recorded under when the row was deleted between the
// claim and reading it back, so its scope can no longer be known.
const UNKNOWN_SCOPE = "unknown";

function policyRejection(
  error: Parameters<typeof rejectionCodeOf>[0],
): MediaRejection {
  return { reason: error.message, code: rejectionCodeOf(error) };
}

/**
 * Turns a quarantined upload into a displayable image, or rejects it.
 *
 * Every upload passes through here whichever storage path it took, so this is
 * where the bytes are actually checked: decoded, matched against the declared
 * type, and held to the size and dimension policy. An accepted image is then
 * re-encoded rather than copied. Re-encoding strips metadata a client may not
 * have meant to publish (EXIF, GPS), applies the EXIF orientation so the
 * stored pixels are upright, and means what is served was produced by this
 * process rather than supplied by the client. It also scales the image down so
 * its longest edge is within `imageUploads.maxProcessedEdge`, since the full
 * upload can be far larger than anything the UI displays. The upload is
 * decoded once. The two smaller renditions, medium and thumbnail, are then
 * scaled from the encoded processed image, which is far cheaper to decode than
 * a full-size upload, and all three are written before the item is marked
 * ready, so a ready image always has them.
 *
 * The upload credential outlives completion, so the blob may have been written
 * again since. Its properties are checked before anything is downloaded: the
 * ETag must still be the one recorded at completion, and the length must be
 * within policy. The download is then conditional on that ETag and capped at
 * one byte past the limit, so a replaced or oversized blob is refused without
 * being buffered.
 */
export class MediaProcessingService {
  private readonly logger = loggerFactory.forClass(
    MediaProcessingService,
    "service",
  );

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly blobService: BlobService,
    private readonly metrics: MediaMetrics,
  ) {}

  // What the shared rejection routine needs from this service.
  private get rejection() {
    return {
      mediaRepository: this.mediaRepository,
      blobService: this.blobService,
      logger: this.logger,
      metrics: this.metrics,
    };
  }

  /**
   * Processes one media item. Returns normally when the item is finished,
   * either way, or was not in a state to process. Throws only for failures
   * that a retry could fix, such as storage being unavailable.
   */
  async process(mediaId: Uuid): Promise<void> {
    // A missing, pending, ready, or rejected row cannot be claimed, which makes
    // a duplicate or late job a no-op.
    if (!(await this.mediaRepository.claimForProcessing(mediaId))) {
      return;
    }

    // Timed from the claim, so every claimed attempt records one duration,
    // including one that throws and is retried, and one whose row is deleted
    // before it can be read back.
    const startedAt = performance.now();
    let scope = UNKNOWN_SCOPE;
    let outcome: MediaProcessingOutcome = "failed";

    try {
      const record = await this.mediaRepository.findById(mediaId);

      if (!record) {
        outcome = "discarded";
        return;
      }

      scope = record.scope;
      outcome = await this.processClaimed(record);
    } finally {
      this.metrics.observe(
        "media.processing.duration",
        performance.now() - startedAt,
        { scope, outcome },
      );
    }
  }

  private async processClaimed(
    record: MediaRecord,
  ): Promise<MediaProcessingOutcome> {
    const original = await this.downloadOriginal(record);

    if ("rejection" in original) {
      return this.reject(record, original.rejection);
    }

    // Progress is recorded between stages, so the media cleanup, which takes
    // an item that has not moved in a while for one whose job was lost, never
    // mistakes a slow job for a lost one.
    await this.mediaRepository.recordProcessingProgress(record.id);

    let detectedContentType: SupportedImageContentType;

    try {
      detectedContentType = await this.inspect(record, original.body);
    } catch (error) {
      if (isImagePolicyRejection(error)) {
        return this.reject(record, policyRejection(error));
      }

      throw error;
    }

    const policy = environment.getImageUploadsConfig();
    // Rotated first, so the cap applies to the upright image. The upload is
    // decoded once, here; the smaller renditions come from the result.
    const processed = await renderImage(
      sharp(original.body, {
        limitInputPixels: policy.maxPixels,
        failOn: IMAGE_DECODE_FAIL_ON,
      }).rotate(),
      policy.maxProcessedEdge,
    );
    const renditions = await renderSmallerRenditions(
      processed.data,
      processed.width,
    );
    await this.mediaRepository.recordProcessingProgress(record.id);
    const processedBlobName = this.blobService.buildProcessedImageBlobName(
      record.userId,
      record.id,
    );
    const renditionNames = buildImageVariantBlobNames(processedBlobName);

    if (!renditionNames) {
      throw new Error("Processed image name has no renditions.");
    }

    // All three at once. A failure part way through throws, and the retried
    // job writes every rendition again under the same names.
    const [, variants] = await Promise.all([
      this.blobService.uploadBuffer({
        blobName: processedBlobName,
        body: processed.data,
        contentType: PROCESSED_IMAGE_CONTENT_TYPE,
      }),
      uploadSmallerRenditions(this.blobService, renditionNames, renditions),
    ]);

    // sizeBytes, width, and height now describe what is served, not what was
    // uploaded; detectedContentType records what the upload really was.
    const marked = await this.mediaRepository.markReady(record.id, {
      processedBlobName,
      detectedContentType,
      sizeBytes: processed.data.byteLength,
      width: processed.width,
      height: processed.height,
      variants,
    });

    if (!marked && !(await this.isReadyAs(record.id, processedBlobName))) {
      // The row was deleted, or rejected by a dead-lettered duplicate, while
      // this ran. Nothing references the renditions just written.
      await Promise.all(
        listImageVariantBlobNames(processedBlobName).map((blobName) =>
          this.blobService.deleteBlob(blobName),
        ),
      );
      return "discarded";
    }

    // Only the job that marked the item ready counts it; a duplicate that
    // finds it already ready does not.
    if (!marked) {
      await deleteQuarantinedUpload(this.rejection, record);
      return "discarded";
    }

    this.metrics.increment("media.processing.success", { scope: record.scope });
    this.metrics.observe("media.bytes.processed", processed.data.byteLength, {
      scope: record.scope,
    });
    await deleteQuarantinedUpload(this.rejection, record);
    return "ready";
  }

  /**
   * Keeps the failure a job hit on an unfinished item, for operators. Called
   * before the job is retried or dead-lettered.
   */
  async recordProcessingFailure(mediaId: Uuid, error: unknown): Promise<void> {
    await this.mediaRepository.recordProcessingFailure(mediaId, error);
  }

  /**
   * Called when a job has exhausted its retries, so the client stops waiting
   * on an item that will never become ready. A no-op if it already finished.
   */
  async markProcessingFailed(mediaId: Uuid): Promise<void> {
    const record = await this.mediaRepository.findById(mediaId);

    if (!record) {
      return;
    }

    await rejectMedia(
      this.rejection,
      record,
      PROCESSING_FAILED_REASON,
      "processing_failed",
      "dead_letter",
    );
  }

  private async inspect(
    record: MediaRecord,
    original: Buffer,
  ): Promise<SupportedImageContentType> {
    assertImageNotEmpty(original.byteLength);
    assertImageSizeWithinLimit(original.byteLength);

    // Re-checked against today's allow-list: a type narrowed out since the
    // credential was issued is rejected rather than published.
    return assertImageBytes(
      original,
      normalizeImageContentType(record.declaredContentType),
    );
  }

  /**
   * Checks the original's properties, then downloads exactly that blob. A
   * refusal is final and comes back as the reason; anything else a retry could
   * fix, such as storage being unavailable, is thrown.
   */
  private async downloadOriginal(
    record: MediaRecord,
  ): Promise<{ body: Buffer } | { rejection: MediaRejection }> {
    let properties: BlobProperties;

    try {
      properties = await this.blobService.getProperties(
        record.originalBlobName,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return { rejection: MISSING_UPLOAD };
      }

      throw error;
    }

    // First, because it is the accurate reason: an overwrite is often also
    // oversized, and the client should hear that its upload was replaced.
    // Rows completed before the ETag was recorded skip this; their size is
    // still held to the policy below and by the capped download.
    if (record.originalEtag && properties.etag !== record.originalEtag) {
      return { rejection: UPLOAD_CHANGED };
    }

    const sizeBytes = properties.contentLength ?? 0;

    try {
      assertImageNotEmpty(sizeBytes);
      assertImageSizeWithinLimit(sizeBytes);
    } catch (error) {
      if (isImagePolicyRejection(error)) {
        return { rejection: policyRejection(error) };
      }

      throw error;
    }

    try {
      const { body } = await this.blobService.downloadBlob(
        record.originalBlobName,
        {
          ifMatch: properties.etag,
          maxBytes: environment.getImageUploadsConfig().maxSizeBytes,
        },
      );

      return { body };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return { rejection: MISSING_UPLOAD };
      }

      if (error instanceof BlobChangedError) {
        return { rejection: UPLOAD_CHANGED };
      }

      if (error instanceof PayloadTooLargeError) {
        return {
          rejection: { reason: describeImageSizeLimit(), code: "too_large" },
        };
      }

      throw error;
    }
  }

  /**
   * `rejected` when this attempt rejected the item; `discarded` when another
   * actor, such as a duplicate job, finished it first.
   */
  private async reject(
    record: MediaRecord,
    rejection: MediaRejection,
  ): Promise<"rejected" | "discarded"> {
    const rejected = await rejectMedia(
      this.rejection,
      record,
      rejection.reason,
      rejection.code,
      "processing",
    );

    return rejected ? "rejected" : "discarded";
  }

  private async isReadyAs(
    mediaId: Uuid,
    processedBlobName: string,
  ): Promise<boolean> {
    const current = await this.mediaRepository.findById(mediaId);

    return (
      current?.status === "ready" &&
      current.processedBlobName === processedBlobName
    );
  }
}
