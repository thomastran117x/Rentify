import { newUuid, type Uuid } from "@/configuration/validation/uuid";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import type { BlobService } from "@/features/blob/blob.service";
import {
  assertImageNotEmpty,
  assertImageSizeWithinLimit,
  normalizeImageContentType,
} from "@/features/media/image-policy";
import type { MediaProcessingQueueService } from "@/features/media/media-processing.queue.service";
import type { MediaRepository } from "@/features/media/media.repository";
import { rejectMedia } from "@/features/media/media-rejection";
import { loggerFactory } from "@/configuration/logging";
import type {
  AttachableImage,
  CompleteImageUploadInput,
  CreateImageUploadInput,
  CreatedMediaUpload,
  ImageReferenceInput,
  ImageReferenceOptions,
  MediaRecord,
  MediaScope,
  MediaView,
} from "@/features/media/media.model";

// A row left in `uploaded` this long has lost its processing job (the enqueue
// failed after the status changed), so completing it again re-queues it.
const STALE_UPLOADED_MS = 60 * 1000;

/**
 * Owns the rules for user-uploaded images: what may be uploaded, the lifecycle
 * of a media record from upload credential to processed image, and who an image
 * belongs to. Storage itself is delegated to BlobService, which knows nothing
 * about images.
 *
 * Feature services that attach an uploaded image go through here rather than
 * BlobService, so that "may this image be attached" is decided in one place:
 * resolveAttachableImage, which only ever yields a processed image.
 */
export class MediaService {
  private readonly logger = loggerFactory.forClass(MediaService, "service");

  constructor(
    private readonly blobService: BlobService,
    private readonly mediaRepository: MediaRepository,
    private readonly mediaProcessingQueue: Pick<
      MediaProcessingQueueService,
      "enqueueMediaProcessingJob"
    >,
  ) {}

  /**
   * Records the upload, then signs a credential for its quarantine name. The
   * row comes first so that no upload credential ever exists for bytes the
   * application is not tracking.
   */
  async createMediaUpload(
    input: CreateImageUploadInput,
  ): Promise<CreatedMediaUpload> {
    const contentType = normalizeImageContentType(input.contentType);

    // Advisory - the client declares this and can lie. It catches an honest
    // oversized upload before a slow transfer; the authoritative checks run
    // against the stored length on completion and the real bytes in the worker.
    if (input.sizeBytes !== undefined) {
      assertImageSizeWithinLimit(input.sizeBytes);
    }

    if (!this.blobService.isConfigured()) {
      throw new ServiceNotImplementedError(
        "Image uploads require Blob Storage to be configured on the backend.",
      );
    }

    const mediaId = newUuid();
    const record = await this.mediaRepository.create({
      id: mediaId,
      userId: input.userId,
      scope: input.scope,
      originalBlobName: this.blobService.buildQuarantineImageBlobName(
        input.userId,
        mediaId,
      ),
      declaredContentType: contentType,
      originalFilename: input.filename.trim().slice(0, 255) || null,
    });
    const target = this.blobService.createUploadUrl({
      blobName: record.originalBlobName,
      contentType,
      requestOrigin: input.requestOrigin,
    });

    // Deliberately not the whole target: its blobName and blobUrl point into
    // quarantine, and nothing a client receives may address quarantined bytes.
    return {
      mediaId: record.id,
      upload: {
        method: target.method,
        url: target.uploadUrl,
        expiresAt: target.expiresAt,
        headers: target.headers,
      },
    };
  }

  /**
   * Called by the client once its PUT has finished. Confirms the bytes exist,
   * applies the size limit to their real length, and queues processing.
   * Repeating it is harmless: past pending_upload it reports the current state.
   *
   * The blob's ETag is recorded with its size. The upload credential is still
   * valid after this, so the worker only processes the bytes seen here and
   * refuses a blob that was written again, even with identical content.
   */
  async completeMediaUpload(userId: Uuid, mediaId: Uuid): Promise<MediaView> {
    const record = await this.requireOwnedRecord(userId, mediaId);

    if (record.status === "uploaded" && this.isStale(record)) {
      await this.mediaProcessingQueue.enqueueMediaProcessingJob(record.id);
      return this.toView(record);
    }

    if (record.status !== "pending_upload") {
      return this.toView(record);
    }

    const { sizeBytes, etag } = await this.readUploadedProperties(record);

    try {
      assertImageNotEmpty(sizeBytes);
      assertImageSizeWithinLimit(sizeBytes);
    } catch (error) {
      await this.reject(record, (error as Error).message);
      throw error;
    }

    if (await this.mediaRepository.markUploaded(record.id, sizeBytes, etag)) {
      await this.mediaProcessingQueue.enqueueMediaProcessingJob(record.id);
    }

    return this.toView(await this.requireOwnedRecord(userId, mediaId));
  }

  async getMediaView(userId: Uuid, mediaId: Uuid): Promise<MediaView> {
    return this.toView(await this.requireOwnedRecord(userId, mediaId));
  }

  /**
   * Deletes a media item the user no longer needs, such as an upload that was
   * never saved. An image something still displays is refused rather than
   * deleted: the client cannot always know its save went through, and a
   * deleted blob cannot be brought back.
   */
  async deleteMediaById(userId: Uuid, mediaId: Uuid): Promise<void> {
    const record = await this.requireOwnedRecord(userId, mediaId);

    if (
      record.processedBlobName &&
      (await this.mediaRepository.isBlobAttached(record.processedBlobName))
    ) {
      throw new ConflictError("This image is in use and cannot be deleted.");
    }

    await this.deleteRecordBlobs(record);
    await this.mediaRepository.deleteById(record.id);
  }

  /**
   * The single rule for a request field that holds an image: a posting photo,
   * an avatar, an organization logo, or a blog cover.
   *
   * A new image arrives only as a media id, and resolves to its processed image
   * once it is ready, owned by the user, and uploaded for this scope. The image
   * already stored may be resent unchanged as its URL and blob name, whoever
   * uploaded it, or cleared by sending both as null. Any other blob reference
   * is refused, even one whose name records the user as its owner.
   *
   * Returns the image to store, `null` to clear the field, or `undefined` when
   * the request left the field out.
   */
  async resolveImageReference(
    userId: Uuid,
    input: ImageReferenceInput,
    options: ImageReferenceOptions,
  ): Promise<AttachableImage | null | undefined> {
    const { fields } = options;

    if (input.mediaId) {
      if (input.url || input.blobName) {
        throw new BadRequestError(
          `Send either ${fields.mediaId} or ${fields.url} and ${fields.blobName}, not both.`,
        );
      }

      return this.resolveAttachableImage(userId, input.mediaId, options.scope);
    }

    if (input.url === undefined && input.blobName === undefined) {
      return undefined;
    }

    if (!input.url && !input.blobName) {
      return null;
    }

    if (!input.url || !input.blobName) {
      throw new BadRequestError(
        `${fields.url} and ${fields.blobName} must be sent together, or both be null.`,
      );
    }

    const url = input.url.trim();
    const blobName = input.blobName.trim();

    if (!options.storedBlobNames.has(blobName)) {
      throw new BadRequestError(
        `A new image must be uploaded and sent as ${fields.mediaId}.`,
      );
    }

    if (!this.isManagedUrl(url, blobName)) {
      throw new BadRequestError(
        `${fields.url} does not match the stored image for ${fields.blobName}.`,
      );
    }

    return { blobUrl: url, blobName };
  }

  /**
   * Resolves a media id to its processed image. Only a ready item owned by the
   * user and uploaded for `scope` resolves; what it resolves to is always the
   * processed image, never the quarantined upload.
   */
  private async resolveAttachableImage(
    userId: Uuid,
    mediaId: Uuid,
    scope: MediaScope,
  ): Promise<AttachableImage> {
    const record = await this.mediaRepository.findById(mediaId);

    if (!record || record.userId !== userId) {
      throw new BadRequestError("Image is not available.");
    }

    if (record.status === "rejected") {
      throw new BadRequestError(
        record.rejectionReason
          ? `Image was rejected: ${record.rejectionReason}`
          : "Image was rejected.",
      );
    }

    if (record.status !== "ready" || !record.processedBlobName) {
      throw new BadRequestError(
        "Image is still processing. Try again once it is ready.",
      );
    }

    if (record.scope !== scope) {
      throw new BadRequestError(`Image was not uploaded for ${scope}.`);
    }

    return {
      blobName: record.processedBlobName,
      blobUrl: this.blobService.getBlobUrl(record.processedBlobName),
    };
  }

  /**
   * Accepts the bytes of a local-development upload. Azure uploads go straight
   * to storage and never reach this; see "Image Upload Validation" in
   * docs/architecture-overview.md.
   *
   * Only a quarantine name issued for a media item awaiting its bytes is
   * accepted. Byte validation is not done here: it runs in the media
   * processing worker for both storage paths, so the local stand-in behaves
   * like Azure. The size limit is kept because it costs nothing and bounds
   * what is written to disk.
   */
  async receiveLocalUploadBytes(
    input: CompleteImageUploadInput,
  ): Promise<void> {
    // Token first, deliberately: no work on behalf of a caller who has not
    // proved they hold a valid upload URL.
    this.blobService.assertLocalUploadToken(
      input.blobName,
      input.expiresAt,
      input.token,
    );

    const record = this.blobService.isQuarantineBlobName(input.blobName)
      ? await this.mediaRepository.findByOriginalBlobName(input.blobName.trim())
      : null;

    if (!record || record.status !== "pending_upload") {
      throw new BadRequestError("Blob upload URL is no longer valid.");
    }

    assertImageSizeWithinLimit(input.body.byteLength);

    await this.blobService.writeLocalBlob(
      record.originalBlobName,
      input.body,
      record.declaredContentType,
    );
  }

  /**
   * Deletes an image a feature has just replaced, by the blob name it stored,
   * together with its media record when it is a processed image. Unlike
   * deleteMediaById it does not check whether the image is attached: the
   * caller has already detached it, and checks for itself whether anything
   * else, such as a restorable audit entry, still needs it.
   */
  async deleteReplacedImageByBlobName(
    userId: Uuid,
    blobName: string,
  ): Promise<void> {
    this.assertOwnedBy(userId, blobName);
    await this.deleteImageBlobs(blobName);

    if (!this.blobService.isProcessedImageBlobName(blobName)) {
      return;
    }

    const record = await this.mediaRepository.findByProcessedBlobName(
      blobName.trim(),
    );

    if (record) {
      await this.mediaRepository.deleteById(record.id);
    }
  }

  isOwnedBy(userId: Uuid, blobName: string): boolean {
    return this.blobService.getBlobOwnerId(blobName) === userId;
  }

  assertOwnedBy(userId: Uuid, blobName: string): void {
    if (!this.isOwnedBy(userId, blobName)) {
      throw new BadRequestError("Blob name is invalid.");
    }
  }

  isConfigured(): boolean {
    return this.blobService.isConfigured();
  }

  /**
   * Whether a stored reference points at a blob this deployment manages. A
   * quarantined blob never qualifies, whatever its URL: its owner could
   * otherwise attach their own unvalidated upload by name.
   */
  isManagedUrl(url: string, blobName: string): boolean {
    if (this.blobService.isQuarantineBlobName(blobName)) {
      return false;
    }

    return this.blobService.isManagedBlobUrl(url, blobName);
  }

  isProcessedImageBlobName(blobName: string): boolean {
    return this.blobService.isProcessedImageBlobName(blobName);
  }

  toView(record: MediaRecord): MediaView {
    const url =
      record.status === "ready" && record.processedBlobName
        ? this.blobService.getBlobUrl(record.processedBlobName)
        : null;

    return {
      id: record.id,
      status: record.status,
      scope: record.scope,
      url,
      contentType: record.detectedContentType ?? record.declaredContentType,
      sizeBytes: record.sizeBytes,
      width: record.width,
      height: record.height,
      rejectionReason: record.rejectionReason,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async requireOwnedRecord(
    userId: Uuid,
    mediaId: Uuid,
  ): Promise<MediaRecord> {
    const record = await this.mediaRepository.findById(mediaId);

    // Someone else's media is reported as missing rather than forbidden, so
    // ids cannot be probed for existence.
    if (!record || record.userId !== userId) {
      throw new ResourceNotFoundError("Media not found.");
    }

    return record;
  }

  private async readUploadedProperties(
    record: MediaRecord,
  ): Promise<{ sizeBytes: number; etag: string | null }> {
    try {
      const properties = await this.blobService.getProperties(
        record.originalBlobName,
      );

      return {
        sizeBytes: properties.contentLength ?? 0,
        etag: properties.etag ?? null,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw new ConflictError("The upload has not been received yet.");
      }

      throw error;
    }
  }

  private async reject(record: MediaRecord, reason: string): Promise<void> {
    await rejectMedia(
      {
        mediaRepository: this.mediaRepository,
        blobService: this.blobService,
        logger: this.logger,
      },
      record,
      reason,
    );
  }

  private async deleteRecordBlobs(record: MediaRecord): Promise<void> {
    await this.blobService.deleteBlob(record.originalBlobName);

    if (record.processedBlobName) {
      await this.deleteImageBlobs(record.processedBlobName);
    }
  }

  /**
   * Deletes a stored image. A processed image goes with its renditions, which
   * nothing references by name; any other name is a single blob.
   */
  private async deleteImageBlobs(blobName: string): Promise<void> {
    const variants = this.blobService.buildImageVariantBlobNames(blobName);
    const blobNames = variants
      ? [variants.large, variants.medium, variants.thumbnail]
      : [blobName];

    for (const name of blobNames) {
      await this.blobService.deleteBlob(name);
    }
  }

  private isStale(record: MediaRecord): boolean {
    return Date.now() - record.updatedAt.getTime() >= STALE_UPLOADED_MS;
  }
}
