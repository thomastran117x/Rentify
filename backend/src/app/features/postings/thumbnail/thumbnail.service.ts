import sharp from "sharp";
import type { BlobService } from "@/features/blob/blob.service";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";

const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 480;
const THUMBNAIL_QUALITY = 80;

export class PostingThumbnailService {
  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly blobService: BlobService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {}

  async generateForPosting(postingId: string): Promise<void> {
    const primaryPhoto =
      await this.postingsRepository.findPrimaryPhotoForThumbnailing(postingId);

    if (!primaryPhoto) {
      return;
    }

    if (primaryPhoto.thumbnailBlobName && primaryPhoto.thumbnailBlobUrl) {
      return;
    }

    const original = await this.blobService.downloadBlob(primaryPhoto.blobName);
    const thumbnailBuffer = await sharp(original.body)
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
}
