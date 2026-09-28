import sharp from "sharp";
import { environment } from "@/configuration/environment/index";
import type { BlobService } from "@/features/blob/blob.service";
import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { MediaRepository } from "@/features/media/media.repository";
import type { Uuid } from "@/configuration/validation/uuid";

const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 480;
const THUMBNAIL_QUALITY = 80;

export class PostingThumbnailService {
  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly blobService: BlobService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly mediaRepository: Pick<
      MediaRepository,
      "findByProcessedBlobName"
    >,
  ) {}

  async generateForPosting(postingId: Uuid): Promise<void> {
    const primaryPhoto =
      await this.postingsRepository.findPrimaryPhotoForThumbnailing(postingId);

    if (!primaryPhoto) {
      return;
    }

    if (primaryPhoto.thumbnailBlobName && primaryPhoto.thumbnailBlobUrl) {
      return;
    }

    const original = await this.blobService.downloadBlob(
      await this.chooseSource(primaryPhoto.blobName),
    );
    // Uploads are pixel-budgeted before they are stored, but blobs written
    // before that policy existed were not, so cap the decode here too rather
    // than relying on sharp's much larger default.
    const thumbnailBuffer = await sharp(original.body, {
      limitInputPixels: environment.getImageUploadsConfig().maxPixels,
    })
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
        fit: "cover",
        position: "centre",
      })
      .webp({
        quality: THUMBNAIL_QUALITY,
      })
      .toBuffer();

    const thumbnailBlobName =
      this.blobService.buildPostingPhotoThumbnailBlobName(
        primaryPhoto.blobName,
      );
    const uploaded = await this.blobService.uploadBuffer({
      blobName: thumbnailBlobName,
      body: thumbnailBuffer,
      contentType: "image/webp",
    });

    await this.postingsRepository.updatePostingPhotoThumbnail(primaryPhoto.id, {
      thumbnailBlobName: uploaded.blobName,
      thumbnailBlobUrl: uploaded.blobUrl,
    });
    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      postingId,
    );
    await this.postingsRepository.enqueueSearchSync(postingId);
  }

  /**
   * The blob to crop from. A processed photo's medium rendition is enough for a
   * 640x480 crop and decodes far faster than the full image, so it is used when
   * the media row records one that covers the crop without enlarging. Its
   * recorded size decides this, so nothing is downloaded only to be discarded.
   * The full photo is used for anything else: an image with no renditions, one
   * not yet backfilled, or one whose shape leaves the medium too small, such
   * as a panorama.
   */
  private async chooseSource(blobName: string): Promise<string> {
    const renditions = buildImageVariantBlobNames(blobName);

    if (!renditions) {
      return blobName;
    }

    const record = await this.mediaRepository.findByProcessedBlobName(
      renditions.large,
    );
    const medium = record?.variants?.medium;

    return medium &&
      medium.width >= THUMBNAIL_WIDTH &&
      medium.height >= THUMBNAIL_HEIGHT
      ? renditions.medium
      : blobName;
  }
}
