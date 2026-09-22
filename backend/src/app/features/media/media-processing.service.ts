import sharp from "sharp";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import type { Uuid } from "@/configuration/validation/uuid";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import BlobChangedError from "@/errors/blob-changed.error";
import type { BlobService } from "@/features/blob/blob.service";
import type { BlobProperties } from "@/features/blob/blob.model";
import type { SupportedImageContentType } from "@/configuration/environment/constants";
import {
  assertImageBytes,
  assertImageNotEmpty,
  assertImageSizeWithinLimit,
  describeImageSizeLimit,
  isImagePolicyRejection,
  normalizeImageContentType,
} from "@/features/media/image-policy";
import {
  deleteQuarantinedUpload,
  rejectMedia,
} from "@/features/media/media-rejection";
import type { MediaRecord } from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";

const PROCESSED_IMAGE_QUALITY = 85;
const PROCESSED_IMAGE_CONTENT_TYPE = "image/webp";
const MISSING_UPLOAD_REASON = "The uploaded file could not be found.";
const UPLOAD_CHANGED_REASON = "The upload changed after it was completed.";
const PROCESSING_FAILED_REASON = "The image could not be processed.";

/**
 * Turns a quarantined upload into a displayable image, or rejects it.
 *
 * Every upload passes through here whichever storage path it took, so this is
 * where the bytes are actually checked: decoded, matched against the declared
 * type, and held to the size and dimension policy. An accepted image is then
 * re-encoded rather than copied. Re-encoding strips metadata a client may not
 * have meant to publish (EXIF, GPS), applies the EXIF orientation so the
 * stored pixels are upright, and means what is served was produced by this
 * process rather than supplied by the client.
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
  ) {}

  // What the shared rejection routine needs from this service.
  private get rejection() {
    return {
      mediaRepository: this.mediaRepository,
      blobService: this.blobService,
      logger: this.logger,
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

    const record = await this.mediaRepository.findById(mediaId);

    if (!record) {
      return;
    }

    const original = await this.downloadOriginal(record);

    if ("rejection" in original) {
      await this.reject(record, original.rejection);
      return;
    }

    let detectedContentType: SupportedImageContentType;

    try {
      detectedContentType = await this.inspect(record, original.body);
    } catch (error) {
      if (isImagePolicyRejection(error)) {
        await this.reject(record, error.message);
        return;
      }

      throw error;
    }

    const processed = await sharp(original.body, {
      limitInputPixels: environment.getImageUploadsConfig().maxPixels,
      failOn: "error",
    })
      .rotate()
      .webp({ quality: PROCESSED_IMAGE_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const processedBlobName = this.blobService.buildProcessedImageBlobName(
      record.userId,
      record.id,
    );

    await this.blobService.uploadBuffer({
      blobName: processedBlobName,
      body: processed.data,
      contentType: PROCESSED_IMAGE_CONTENT_TYPE,
    });

    // sizeBytes, width, and height now describe what is served, not what was
    // uploaded; detectedContentType records what the upload really was.
    const marked = await this.mediaRepository.markReady(record.id, {
      processedBlobName,
      detectedContentType,
      sizeBytes: processed.data.byteLength,
      width: processed.info.width,
      height: processed.info.height,
    });

    if (!marked && !(await this.isReadyAs(record.id, processedBlobName))) {
      // The row was deleted, or rejected by a dead-lettered duplicate, while
      // this ran. Nothing references the image just written.
      await this.blobService.deleteBlob(processedBlobName);
      return;
    }

    await deleteQuarantinedUpload(this.rejection, record);
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

    await rejectMedia(this.rejection, record, PROCESSING_FAILED_REASON);
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
  ): Promise<{ body: Buffer } | { rejection: string }> {
    let properties: BlobProperties;

    try {
      properties = await this.blobService.getProperties(
        record.originalBlobName,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return { rejection: MISSING_UPLOAD_REASON };
      }

      throw error;
    }

    // First, because it is the accurate reason: an overwrite is often also
    // oversized, and the client should hear that its upload was replaced.
    // Rows completed before the ETag was recorded skip this; their size is
    // still held to the policy below and by the capped download.
    if (record.originalEtag && properties.etag !== record.originalEtag) {
      return { rejection: UPLOAD_CHANGED_REASON };
    }

    const sizeBytes = properties.contentLength ?? 0;

    try {
      assertImageNotEmpty(sizeBytes);
      assertImageSizeWithinLimit(sizeBytes);
    } catch (error) {
      if (isImagePolicyRejection(error)) {
        return { rejection: error.message };
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
        return { rejection: MISSING_UPLOAD_REASON };
      }

      if (error instanceof BlobChangedError) {
        return { rejection: UPLOAD_CHANGED_REASON };
      }

      if (error instanceof PayloadTooLargeError) {
        return { rejection: describeImageSizeLimit() };
      }

      throw error;
    }
  }

  private async reject(record: MediaRecord, reason: string): Promise<void> {
    await rejectMedia(this.rejection, record, reason);
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
