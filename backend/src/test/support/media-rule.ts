import type { BlobService } from "@/features/blob/blob.service";
import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";
import type { MediaScope } from "@/features/media/media.model";
import { MediaService } from "@/features/media/media.service";
import { asUuid } from "@/configuration/validation/uuid";
import { InMemoryMediaRepository } from "./in-memory-media-repository";

const DEFAULT_TEST_BLOB_ORIGIN = "https://cdn.test/";

/**
 * The real MediaService image rule over in-memory media and a storage stub,
 * for feature-service tests. Features apply the rule rather than implement it,
 * so their tests exercise the real one instead of re-mocking its outcomes.
 */
export function createMediaRule(
  options: { managedUrls?: boolean; origin?: string } = {},
) {
  const TEST_BLOB_ORIGIN = options.origin ?? DEFAULT_TEST_BLOB_ORIGIN;
  const repository = new InMemoryMediaRepository();
  const blobService = {
    getBlobUrl: (blobName: string) => `${TEST_BLOB_ORIGIN}${blobName}`,
    isManagedBlobUrl: (url: string, blobName: string) =>
      (options.managedUrls ?? true) && url === `${TEST_BLOB_ORIGIN}${blobName}`,
    isQuarantineBlobName: (blobName: string) =>
      blobName.trim().startsWith("quarantine/"),
    isProcessedImageBlobName: (blobName: string) =>
      blobName.trim().startsWith("media/images/"),
    buildImageVariantBlobNames,
  };
  const mediaService = new MediaService(
    blobService as unknown as BlobService,
    repository.asRepository(),
    { enqueueMediaProcessingJob: jest.fn() },
  );

  return {
    resolveImageReference: jest.fn(
      mediaService.resolveImageReference.bind(mediaService),
    ),
    isProcessedImageBlobName: jest.fn(blobService.isProcessedImageBlobName),
    /** The URL a stored reference to `blobName` must carry. */
    urlFor: (blobName: string) => `${TEST_BLOB_ORIGIN}${blobName}`,
    /** Adds a ready media item and returns its id and processed blob. */
    addReadyMedia(userId: string, mediaId: string, scope: MediaScope) {
      const blobName = `media/images/${userId}/${mediaId}.webp`;
      const now = new Date();

      repository.put({
        id: asUuid(mediaId),
        userId: asUuid(userId),
        status: "ready",
        scope,
        originalBlobName: `quarantine/images/${userId}/${mediaId}`,
        processedBlobName: blobName,
        declaredContentType: "image/png",
        detectedContentType: "image/png",
        originalFilename: null,
        originalEtag: null,
        sizeBytes: 1,
        width: 1,
        height: 1,
        variants: {
          medium: { width: 1, height: 1, sizeBytes: 1 },
          thumbnail: { width: 1, height: 1, sizeBytes: 1 },
        },
        rejectionReason: null,
        createdAt: now,
        updatedAt: now,
      });

      return {
        mediaId: asUuid(mediaId),
        blobName,
        blobUrl: this.urlFor(blobName),
      };
    },
  };
}
