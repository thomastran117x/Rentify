import sharp from "sharp";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { PostingThumbnailService } from "@/features/postings/thumbnail/thumbnail.service";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { BlobService } from "@/features/blob/blob.service";
import { testUuid } from "../../support/uuid";

const POSTING_1_ID = testUuid(9000, 254272);

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

// A valid 1x1 grayscale+alpha PNG. The CRC of every chunk must be correct:
// libpng rejects a bad IDAT checksum outright, so a corrupt fixture fails the
// decode inside sharp rather than exercising the thumbnail pipeline.
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
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

    await service.generateForPosting(POSTING_1_ID);

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
    ).toHaveBeenCalledWith(POSTING_1_ID);
    expect(repository.enqueuedSearchPostingId).toBe(POSTING_1_ID);
  });

  describe("the crop source of a processed photo", () => {
    const PROCESSED = "media/images/owner-1/photo-1.webp";
    const MEDIUM = "media/images/owner-1/photo-1.medium.webp";

    function image(width: number, height: number) {
      return sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .webp()
        .toBuffer();
    }

    async function generate(
      download: (blobName: string) => Promise<{ body: Buffer }>,
    ) {
      const repository = new FakePostingsRepository();
      repository.primaryPhoto = {
        ...repository.primaryPhoto,
        blobName: PROCESSED,
      };
      const downloadBlob = jest.fn(download);
      const uploadBuffer = jest.fn(
        async (_input: { blobName: string; body: Buffer }) => ({
          blobName: "media/images/owner-1/thumbnails/photo-1.webp",
          blobUrl: "https://cdn.test/thumbnails/photo-1.webp",
        }),
      );
      const service = new PostingThumbnailService(
        repository as unknown as PostingsRepository,
        {
          downloadBlob,
          uploadBuffer,
          buildPostingPhotoThumbnailBlobName: () =>
            "media/images/owner-1/thumbnails/photo-1.webp",
        } as unknown as BlobService,
        {
          invalidatePublic: jest.fn(async () => 1),
        } as unknown as PostingsPublicCacheService,
      );

      await service.generateForPosting(POSTING_1_ID);

      const [upload] = uploadBuffer.mock.calls[0] ?? [];
      return {
        downloaded: downloadBlob.mock.calls.map(([name]) => name),
        crop: upload ? await sharp(upload.body).metadata() : undefined,
      };
    }

    it("crops from the medium rendition when it covers the crop", async () => {
      const medium = await image(800, 600);

      const { downloaded, crop } = await generate(async () => ({
        body: medium,
      }));

      expect(downloaded).toEqual([MEDIUM]);
      expect(crop).toMatchObject({ width: 640, height: 480 });
    });

    it("crops from the full photo when the medium rendition is too small", async () => {
      // A panorama: 800x200 would have to be enlarged to fill 640x480.
      const medium = await image(800, 200);
      const full = await image(2560, 640);

      const { downloaded, crop } = await generate(async (name) => ({
        body: name === MEDIUM ? medium : full,
      }));

      expect(downloaded).toEqual([MEDIUM, PROCESSED]);
      expect(crop).toMatchObject({ width: 640, height: 480 });
    });

    it("crops from the full photo when it has no medium rendition yet", async () => {
      const full = await image(1600, 1200);

      const { downloaded, crop } = await generate(async (name) => {
        if (name === MEDIUM) {
          throw new ResourceNotFoundError("Blob could not be found.");
        }
        return { body: full };
      });

      expect(downloaded).toEqual([MEDIUM, PROCESSED]);
      expect(crop).toMatchObject({ width: 640, height: 480 });
    });

    it("surfaces a storage failure so the job is retried", async () => {
      await expect(
        generate(async () => {
          throw new Error("storage unavailable");
        }),
      ).rejects.toThrow("storage unavailable");
    });
  });

  it("bails out when a primary photo already has a thumbnail", async () => {
    const repository = new FakePostingsRepository();
    repository.primaryPhoto = {
      ...repository.primaryPhoto,
      thumbnailBlobName: "postings/thumbnails/photo-1.webp",
      thumbnailBlobUrl:
        "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
    } as any;
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

    await service.generateForPosting(POSTING_1_ID);

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(repository.updatedThumbnail).toBeNull();
  });

  it("does nothing when the posting has no primary photo", async () => {
    const repository = new FakePostingsRepository();
    repository.primaryPhoto = null as any;
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

    await service.generateForPosting(POSTING_1_ID);

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(repository.updatedThumbnail).toBeNull();
    expect(repository.enqueuedSearchPostingId).toBeNull();
  });
});
