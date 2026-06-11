import { PostingThumbnailService } from "@/features/postings/thumbnail/thumbnail.service";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { BlobService } from "@/features/blob/blob.service";

class FakePostingsRepository {
  primaryPhoto = {
    id: "photo-1",
    blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
    blobName: "postings/photo-1.jpg",
    position: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  updatedThumbnail: {
    photoId: string;
    thumbnailBlobName: string;
    thumbnailBlobUrl: string;
  } | null = null;
  enqueuedSearchPostingId: string | null = null;

  async findPrimaryPhotoForThumbnailing() {
    return this.primaryPhoto;
  }

  async updatePostingPhotoThumbnail(
    photoId: string,
    input: { thumbnailBlobName: string; thumbnailBlobUrl: string },
  ) {
    this.updatedThumbnail = {
      photoId,
      thumbnailBlobName: input.thumbnailBlobName,
      thumbnailBlobUrl: input.thumbnailBlobUrl,
    };
  }

  async enqueueSearchSync(postingId: string) {
    this.enqueuedSearchPostingId = postingId;
  }
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=",
  "base64",
);

describe("PostingThumbnailService", () => {
  it("generates a thumbnail, persists it, and enqueues search sync", async () => {
    const repository = new FakePostingsRepository();
    const downloadBlob = jest.fn(async () => ({
      body: onePixelPng,
      contentType: "image/png",
    }));
    const uploadBuffer = jest.fn(async () => ({
      blobName: "postings/thumbnails/photo-1.webp",
      blobUrl:
        "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
    }));
    const buildPostingPhotoThumbnailBlobName = jest.fn(
      () => "postings/thumbnails/photo-1.webp",
    );
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;
    const service = new PostingThumbnailService(
      repository as unknown as PostingsRepository,
      {
        downloadBlob,
        uploadBuffer,
        buildPostingPhotoThumbnailBlobName,
      } as unknown as BlobService,
      postingsPublicCacheService,
    );

    await service.generateForPosting("posting-1");

    expect(downloadBlob).toHaveBeenCalledWith("postings/photo-1.jpg");
    expect(buildPostingPhotoThumbnailBlobName).toHaveBeenCalledWith(
      "postings/photo-1.jpg",
    );
    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        blobName: "postings/thumbnails/photo-1.webp",
        contentType: "image/webp",
      }),
    );
    expect(repository.updatedThumbnail).toEqual({
      photoId: "photo-1",
      thumbnailBlobName: "postings/thumbnails/photo-1.webp",
      thumbnailBlobUrl:
        "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
    });
    expect(
      postingsPublicCacheService.invalidatePublic as unknown as jest.Mock,
    ).toHaveBeenCalledWith("posting-1");
    expect(repository.enqueuedSearchPostingId).toBe("posting-1");
  });

  it("bails out when a primary photo already has a thumbnail", async () => {
    const repository = new FakePostingsRepository();
    repository.primaryPhoto = {
      ...repository.primaryPhoto,
      thumbnailBlobName: "postings/thumbnails/photo-1.webp",
      thumbnailBlobUrl:
        "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
    };
    const downloadBlob = jest.fn();
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;
    const service = new PostingThumbnailService(
      repository as unknown as PostingsRepository,
      {
        downloadBlob,
      } as unknown as BlobService,
      postingsPublicCacheService,
    );

    await service.generateForPosting("posting-1");

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(repository.updatedThumbnail).toBeNull();
  });

  it("does nothing when the posting has no primary photo", async () => {
    const repository = new FakePostingsRepository();
    repository.primaryPhoto = null as never;
    const downloadBlob = jest.fn();
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;
    const service = new PostingThumbnailService(
      repository as unknown as PostingsRepository,
      {
        downloadBlob,
      } as unknown as BlobService,
      postingsPublicCacheService,
    );

    await service.generateForPosting("posting-1");

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(repository.updatedThumbnail).toBeNull();
    expect(repository.enqueuedSearchPostingId).toBeNull();
  });
});
