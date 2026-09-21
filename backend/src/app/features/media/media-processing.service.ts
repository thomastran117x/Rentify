import sharp from "sharp";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import type { Uuid } from "@/configuration/validation/uuid";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BlobService } from "@/features/blob/blob.service";
import type { SupportedImageContentType } from "@/configuration/environment/constants";
import {
  assertImageBytes,
  assertImageSizeWithinLimit,
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

    if (!original) {
      await this.reject(record, MISSING_UPLOAD_REASON);
      return;
    }

    let detectedContentType: SupportedImageContentType;

    try {
      detectedContentType = await this.inspect(record, original);
    } catch (error) {
      if (isImagePolicyRejection(error)) {
        await this.reject(record, error.message);
        return;
      }

      throw error;
    }

    const processed = await sharp(original, {
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
    assertImageSizeWithinLimit(original.byteLength);

    // Re-checked against today's allow-list: a type narrowed out since the
    // credential was issued is rejected rather than published.
    return assertImageBytes(
      original,
      normalizeImageContentType(record.declaredContentType),
    );
  }

  private async downloadOriginal(record: MediaRecord): Promise<Buffer | null> {
    try {
      return (await this.blobService.downloadBlob(record.originalBlobName))
        .body;
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
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
