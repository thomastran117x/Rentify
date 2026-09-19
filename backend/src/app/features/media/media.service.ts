import path from "node:path";
import type { SupportedImageContentType } from "@/configuration/environment/constants";
import type { Uuid } from "@/configuration/validation/uuid";
import BadRequestError from "@/errors/http/bad-request.error";
import type { BlobUploadTarget } from "@/features/blob/blob.model";
import type { BlobService } from "@/features/blob/blob.service";
import {
  assertImageBytes,
  assertImageSizeWithinLimit,
  imageExtensionForContentType,
  normalizeImageContentType,
} from "@/features/media/image-policy";
import type {
  CompleteImageUploadInput,
  CreateImageUploadInput,
  MediaItem,
} from "@/features/media/media.model";

/**
 * Owns the rules for user-uploaded images: what may be uploaded, whether the
 * uploaded bytes are acceptable, and who a stored image belongs to. Storage
 * itself is delegated to BlobService, which knows nothing about images.
 *
 * Feature services that attach an uploaded image go through here rather than
 * BlobService, so that "may this image be attached" is decided in one place.
 */
export class MediaService {
  constructor(private readonly blobService: BlobService) {}

  createImageUpload(input: CreateImageUploadInput): BlobUploadTarget {
    // Upload credentials are only ever issued for images. There is no
    // client-controlled escape hatch: a caller cannot opt out of the allow-list
    // by declaring a different kind of upload.
    const contentType = normalizeImageContentType(input.contentType);

    // Advisory - the client declares this and can lie. It catches an honest
    // oversized upload before a slow transfer; the authoritative check runs
    // against the real bytes on the upload path.
    if (input.sizeBytes !== undefined) {
      assertImageSizeWithinLimit(input.sizeBytes);
    }

    // The stored extension comes from the validated content type, never from
    // the client's filename. A file called "photo.png" declared as image/jpeg
    // is stored as .jpg: the extension is a consequence of the format, not
    // evidence of it. Where the two disagree the content type wins silently -
    // the client controls both fields, so rejecting the mismatch would buy no
    // safety while breaking legitimate cases like .jpeg/.jpg or a renamed
    // download.
    const blobName = this.blobService.buildBlobName({
      ownerId: input.userId,
      extension: imageExtensionForContentType(contentType),
      scope: input.scope,
    });

    return this.blobService.createUploadUrl({
      blobName,
      contentType,
      requestOrigin: input.requestOrigin,
    });
  }

  /**
   * Accepts the bytes of a local-development upload. Azure uploads go straight
   * to storage and never reach this; see "Image Upload Validation" in
   * docs/architecture-overview.md.
   */
  async completeImageUpload(input: CompleteImageUploadInput): Promise<void> {
    // Token first, deliberately: no image decoding work on behalf of a caller
    // who has not proved they hold a valid upload URL.
    this.blobService.assertLocalUploadToken(
      input.blobName,
      input.expiresAt,
      input.token,
    );

    const contentType = normalizeImageContentType(input.contentType);
    this.assertContentTypeMatchesSignedBlob(input.blobName, contentType);
    assertImageSizeWithinLimit(input.body.byteLength);
    await assertImageBytes(input.body, contentType);

    await this.blobService.writeLocalBlob(
      input.blobName,
      input.body,
      contentType,
    );
  }

  /**
   * Describes a stored image. Everything here currently comes from storage;
   * once media has validation state, its record is read and joined in here.
   */
  async getMedia(blobName: string): Promise<MediaItem> {
    const properties = await this.blobService.getProperties(blobName);

    return {
      blobName,
      blobUrl: this.blobService.getBlobUrl(blobName),
      ownerId: this.blobService.getBlobOwnerId(blobName),
      contentType: properties.contentType ?? null,
      sizeBytes: properties.contentLength ?? null,
      lastModified: properties.lastModified ?? null,
    };
  }

  async deleteMedia(userId: Uuid, blobName: string): Promise<void> {
    this.assertOwnedBy(userId, blobName);
    await this.blobService.deleteBlob(blobName);
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

  isManagedUrl(url: string, blobName: string): boolean {
    return this.blobService.isManagedBlobUrl(url, blobName);
  }

  // The upload token signs the blob name but not the content type, so without
  // this a holder of a valid URL could upload a PNG under a name issued for a
  // JPEG. Because the stored extension is derived from the validated content
  // type, the blob name determines the type unambiguously and inverting the
  // extension mapping is enough to bind them.
  //
  // This check is local-only. Azure uploads have no equivalent: the SAS
  // contentType is not an upload constraint (see BlobService), so on that path
  // neither the declared type nor the bytes are verified.
  private assertContentTypeMatchesSignedBlob(
    blobName: string,
    contentType: SupportedImageContentType,
  ): void {
    const extension = path.posix.extname(blobName).toLowerCase();

    if (extension !== imageExtensionForContentType(contentType)) {
      throw new BadRequestError(
        "Content type does not match the requested upload URL.",
      );
    }
  }
}
