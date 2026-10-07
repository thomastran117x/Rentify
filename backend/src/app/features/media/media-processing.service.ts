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
  renderModerationImage,
  renderSmallerRenditions,
  uploadSmallerRenditions,
  type RenderedImage,
} from "@/features/media/image-renditions";
import {
  mediaMetricScope,
  type MediaMetricScope,
  type MediaMetrics,
  type MediaProcessingOutcome,
} from "@/features/media/media-metrics";
import type {
  MediaRecord,
  MediaRejectionCode,
  MediaScanRecord,
  MediaStatus,
} from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";
import type { MalwareScanner } from "@/features/media/scanning/malware-scanner";
import type { ImageModerationService } from "@/features/media/moderation/image-moderation.service";
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
// Deliberately vague: naming the signature would tell an uploader which of
// their files tripped which rule.
const MALWARE: MediaRejection = {
  reason: "This file can't be used.",
  code: "malware",
};
// Names no category, for the same reason: the severities are recorded for
// operators instead.
const MODERATION: MediaRejection = {
  reason: "This image doesn't meet our content guidelines.",
  code: "moderation",
};

// A row in any other state is finished, or not yet uploaded, so a duplicate or
// late job for it does nothing. `processing` is claimable because a worker
// that died mid-job leaves the row there.
const CLAIMABLE_STATUSES: readonly MediaStatus[] = ["uploaded", "processing"];

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
 *
 * The downloaded bytes are then malware-scanned before any decoder reads
 * them, since the image decoders are what a crafted file would attack. An
 * infected upload is rejected and deleted. A scanner that cannot answer
 * throws, so the job is retried and eventually dead-lettered; the repository
 * refuses to mark an item ready without a passing scan of the current
 * attempt.
 *
 * Once the renditions are rendered, and before any of them is written, the
 * image is moderated for harmful visual content: the medium rendition, or the
 * processed image when there is none, is sent to the configured provider. A
 * blocked image is rejected as `moderation` and its upload deleted; nothing of
 * it is ever published. A provider that cannot answer throws like a scanner,
 * and the repository likewise refuses to mark an item ready until the current
 * attempt's moderation has allowed the image.
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
    private readonly scanner: MalwareScanner,
    private readonly moderation: ImageModerationService,
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
    const record = await this.mediaRepository.findById(mediaId);

    if (!record || !CLAIMABLE_STATUSES.includes(record.status)) {
      return;
    }

    // The claim applies only while no other attempt has claimed the row since
    // it was read, so this attempt knows its own number. Its scan and its
    // markReady apply only while that is still the row's latest attempt, so an
    // attempt that a later one has overtaken can neither overwrite the later
    // one's verdict nor publish on the strength of its own. Losing the claim
    // means another job has just taken the item, and this one does nothing.
    if (
      !(await this.mediaRepository.claimForProcessing(
        mediaId,
        record.processingAttempts,
      ))
    ) {
      return;
    }

    const attempt = record.processingAttempts + 1;
    // Timed from the claim, so every claimed attempt records one duration,
    // including one that throws and is retried.
    const startedAt = performance.now();
    const scope: MediaMetricScope = mediaMetricScope(record.scope);
    let outcome: MediaProcessingOutcome = "failed";

    try {
      outcome = await this.processClaimed(record, attempt);
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
    attempt: number,
  ): Promise<MediaProcessingOutcome> {
    const original = await this.downloadOriginal(record);

    if ("rejection" in original) {
      return this.reject(record, original.rejection);
    }

    // Progress is recorded between stages, so the media cleanup, which takes
    // an item that has not moved in a while for one whose job was lost, never
    // mistakes a slow job for a lost one.
    await this.mediaRepository.recordProcessingProgress(record.id);

    const scanned = await this.scan(record, attempt, original.body);

    if (scanned !== "passed") {
      return scanned;
    }

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

    // Moderated before anything is written, so a harmful image never reaches
    // the public container, even under a name no one has been given.
    const moderated = await this.moderate(
      record,
      attempt,
      renditions.medium ?? processed,
    );

    if (moderated !== "passed") {
      return moderated;
    }

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
    const marked = await this.mediaRepository.markReady(record.id, attempt, {
      processedBlobName,
      detectedContentType,
      sizeBytes: processed.data.byteLength,
      width: processed.width,
      height: processed.height,
      variants,
    });

    // Only the attempt that marked the item ready counts it.
    if (!marked) {
      await this.discardOutput(record, processedBlobName);
      return "discarded";
    }

    const scope = mediaMetricScope(record.scope);
    this.metrics.increment("media.processing.success", { scope });
    this.metrics.observe("media.bytes.processed", processed.data.byteLength, {
      scope,
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

  /**
   * Called when this attempt could not mark the item ready after writing its
   * renditions. Every attempt writes the same names, so what happens to them
   * depends on who has the item now:
   *
   * - gone or rejected: nothing references the renditions, so they are
   *   deleted;
   * - ready under these names: a later attempt finished it, and only the
   *   quarantined upload may be left;
   * - otherwise a later attempt is still working and will write the same
   *   names, so everything is left to it. Its download still needs the
   *   upload, and deleting renditions it may already have written would leave
   *   it ready with missing images.
   */
  private async discardOutput(
    record: MediaRecord,
    processedBlobName: string,
  ): Promise<void> {
    const current = await this.mediaRepository.findById(record.id);

    if (!current || current.status === "rejected") {
      await Promise.all(
        listImageVariantBlobNames(processedBlobName).map((blobName) =>
          this.blobService.deleteBlob(blobName),
        ),
      );
      return;
    }

    if (
      current.status === "ready" &&
      current.processedBlobName === processedBlobName
    ) {
      await deleteQuarantinedUpload(this.rejection, record);
    }
  }

  /**
   * Scans the upload and records the verdict. `passed` lets processing go on;
   * an infected upload is rejected here. A scanner failure is thrown, for the
   * job to retry.
   */
  private async scan(
    record: MediaRecord,
    attempt: number,
    body: Buffer,
  ): Promise<"passed" | "rejected" | "discarded"> {
    const result = await this.scanner.scan(body);
    const scan: MediaScanRecord = {
      status: result.verdict,
      engine: result.engine,
      threatName:
        result.verdict === "infected" ? (result.threat ?? null) : null,
    };

    // The row was deleted, finished, or claimed by a later attempt while this
    // ran. That attempt scans for itself, so this one leaves everything to it.
    if (
      !(await this.mediaRepository.recordScanResult(record.id, attempt, scan))
    ) {
      return "discarded";
    }

    if (scan.status !== "infected") {
      return "passed";
    }

    this.logger.warn("Rejected an upload that failed the malware scan.", {
      mediaId: record.id,
      userId: record.userId,
      threat: scan.threatName,
    });
    return this.reject(record, MALWARE);
  }

  /**
   * Moderates the image and records the result. `passed` lets processing go
   * on; a blocked image is rejected here. A provider failure is thrown, for the
   * job to retry and, if the provider stays down, dead-letter: nothing is
   * published unmoderated.
   */
  private async moderate(
    record: MediaRecord,
    attempt: number,
    image: RenderedImage,
  ): Promise<"passed" | "rejected" | "discarded"> {
    const { data } = await renderModerationImage(image);
    const result = await this.moderation.moderate(data);

    // As with the scan: a later attempt has the item and moderates for itself.
    if (
      !(await this.mediaRepository.recordModerationResult(
        record.id,
        attempt,
        result,
      ))
    ) {
      return "discarded";
    }

    if (result.decision === "allow") {
      return "passed";
    }

    this.logger.warn("Rejected an image that failed content moderation.", {
      mediaId: record.id,
      userId: record.userId,
      provider: result.provider,
      categories: result.categories,
    });
    return this.reject(record, MODERATION);
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
}
