import BadRequestError from "@/errors/http/bad-request.error";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";
import { BlobService } from "@/features/blob/blob.service";
import { MediaService } from "@/features/media/media.service";
import { testUuid } from "../../support/uuid";
import {
  readLocalUploadUrl,
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import {
  createGifFixture,
  createJpegFixture,
  createPngFixture,
} from "../../support/image-fixtures";

const USER_1_ID = testUuid(9000, 994259);
const USER_2_ID = testUuid(9000, 994260);

restoreBlobEnvironmentAfterEach();

function createLocalMediaService(): {
  mediaService: MediaService;
  blobService: BlobService;
} {
  useLocalBlobStorage();
  const blobService = new BlobService();

  return { mediaService: new MediaService(blobService), blobService };
}

describe("MediaService", () => {
  describe("createImageUpload", () => {
    it("issues owner-scoped upload credentials for an allowed image", () => {
      const { mediaService, blobService } = createLocalMediaService();

      const target = mediaService.createImageUpload({
        userId: USER_1_ID,
        filename: "photo.png",
        contentType: " image/png ",
        scope: "postings",
        requestOrigin: "http://localhost:8040",
      });

      expect(target.blobName.startsWith(`postings/${USER_1_ID}/`)).toBe(true);
      expect(target.headers["Content-Type"]).toBe("image/png");
      expect(blobService.getBlobOwnerId(target.blobName)).toBe(USER_1_ID);
    });

    it("refuses upload credentials for non-image content types", () => {
      const { mediaService } = createLocalMediaService();

      for (const contentType of [
        "application/pdf",
        "text/html",
        "application/octet-stream",
        "image/svg+xml",
        "image/gif",
        "text/plain\r\nx-test: bad",
      ]) {
        expect(() =>
          mediaService.createImageUpload({
            userId: USER_1_ID,
            filename: "document.pdf",
            contentType,
          }),
        ).toThrow(UnsupportedMediaTypeError);
      }
    });

    it("honours a narrowed allow-list and a declared size limit", () => {
      const { mediaService } = createLocalMediaService();
      process.env.ALLOWED_IMAGE_TYPES = "image/png";
      process.env.MAX_IMAGE_SIZE_BYTES = "1024";

      expect(() =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.jpg",
          contentType: "image/jpeg",
        }),
      ).toThrow(UnsupportedMediaTypeError);
      expect(() =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          sizeBytes: 2048,
        }),
      ).toThrow(PayloadTooLargeError);
      expect(
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          sizeBytes: 512,
        }).blobName,
      ).toMatch(/\.png$/);
    });

    it("derives the stored extension from the content type, not the filename", () => {
      const { mediaService } = createLocalMediaService();
      const issue = (filename: string, contentType: string) =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename,
          contentType,
        }).blobName;

      // A .png filename carrying a JPEG must be stored as .jpg: the filename
      // extension is never treated as proof of format.
      expect(issue("photo.png", "image/jpeg")).toMatch(/\.jpg$/);
      // A filename with no extension at all still produces a correct one.
      expect(issue("screenshot", "image/webp")).toMatch(/\.webp$/);
      // A misleading double extension cannot smuggle one through either.
      expect(issue("payload.php.png", "image/png")).toMatch(/\.png$/);
    });

    it("rejects an invalid scope", () => {
      const { mediaService } = createLocalMediaService();

      expect(() =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          scope: "Invalid Scope",
        }),
      ).toThrow(BadRequestError);
    });
  });

  describe("completeImageUpload", () => {
    function issueUpload(mediaService: MediaService, contentType: string) {
      return readLocalUploadUrl(
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo",
          contentType,
        }).uploadUrl,
      );
    }

    it("stores a valid image under the issued name", async () => {
      const { mediaService, blobService } = createLocalMediaService();
      const upload = issueUpload(mediaService, "image/png");
      const fixture = await createPngFixture();

      await mediaService.completeImageUpload({
        ...upload,
        contentType: "image/png",
        body: fixture,
      });

      const stored = await blobService.readLocalBlob(upload.blobName);
      expect(stored.contentType).toBe("image/png");
      expect(stored.body.equals(fixture)).toBe(true);
    });

    it("validates the bytes of an upload, not just the declared type", async () => {
      const { mediaService } = createLocalMediaService();
      const pngUpload = issueUpload(mediaService, "image/png");

      // Bytes that are not an image at all.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/png",
          body: Buffer.from("not-an-image"),
        }),
      ).rejects.toThrow("Uploaded file could not be read as an image.");

      // A real image whose actual format contradicts the declared one.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/png",
          body: await createJpegFixture(),
        }),
      ).rejects.toThrow(
        "Uploaded file contents do not match the declared image type.",
      );

      // A format sharp can decode but the policy excludes.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/png",
          body: await createGifFixture(),
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);

      // A declared type the allow-list rejects outright.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "application/pdf",
          body: await createPngFixture(),
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);

      // A content type that disagrees with the URL the token was issued for.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/jpeg",
          body: await createJpegFixture(),
        }),
      ).rejects.toThrow(
        "Content type does not match the requested upload URL.",
      );
    });

    it("enforces size and dimension limits", async () => {
      const { mediaService } = createLocalMediaService();
      process.env.MAX_IMAGE_WIDTH = "16";
      process.env.MAX_IMAGE_HEIGHT = "16";
      const upload = {
        ...issueUpload(mediaService, "image/png"),
        contentType: "image/png",
      };

      await expect(
        mediaService.completeImageUpload({
          ...upload,
          body: await createPngFixture(64, 64),
        }),
      ).rejects.toThrow("Image dimensions exceed the allowed maximum.");

      const oversized = await createPngFixture(8, 8);
      process.env.MAX_IMAGE_SIZE_BYTES = String(oversized.byteLength - 1);

      await expect(
        mediaService.completeImageUpload({ ...upload, body: oversized }),
      ).rejects.toThrow(PayloadTooLargeError);
    });

    it("checks the upload token before inspecting the body", async () => {
      const { mediaService } = createLocalMediaService();
      const upload = issueUpload(mediaService, "image/png");

      await expect(
        mediaService.completeImageUpload({
          ...upload,
          token: "bad-token",
          contentType: "application/pdf",
          body: Buffer.from("not-an-image"),
        }),
      ).rejects.toThrow("Blob upload token is invalid.");
    });
  });

  describe("ownership", () => {
    it("deletes media for its owner only", async () => {
      const { mediaService, blobService } = createLocalMediaService();
      const blobName = `organizations/${USER_1_ID}/logo.png`;
      await blobService.uploadBuffer({
        blobName,
        body: Buffer.from("logo"),
        contentType: "image/png",
      });

      await expect(
        mediaService.deleteMedia(USER_2_ID, blobName),
      ).rejects.toThrow("Blob name is invalid.");
      await expect(
        mediaService.deleteMedia(USER_1_ID, "../escape.txt"),
      ).rejects.toThrow(BadRequestError);

      await mediaService.deleteMedia(USER_1_ID, blobName);

      await expect(blobService.readLocalBlob(blobName)).rejects.toThrow(
        ResourceNotFoundError,
      );
    });

    it("answers ownership checks as booleans", () => {
      const { mediaService } = createLocalMediaService();

      expect(
        mediaService.isOwnedBy(USER_1_ID, `organizations/${USER_1_ID}/a.png`),
      ).toBe(true);
      expect(
        mediaService.isOwnedBy(USER_1_ID, `postings/photos/${USER_1_ID}/a.png`),
      ).toBe(true);
      expect(
        mediaService.isOwnedBy(USER_1_ID, `organizations/${USER_2_ID}/a.png`),
      ).toBe(false);
      // A generated thumbnail belongs to whoever owns the original photo.
      expect(
        mediaService.isOwnedBy(
          USER_1_ID,
          `postings/${USER_1_ID}/thumbnails/a.webp`,
        ),
      ).toBe(true);
      expect(mediaService.isOwnedBy(USER_1_ID, "../escape.txt")).toBe(false);
      expect(() =>
        mediaService.assertOwnedBy(USER_1_ID, `general/${USER_2_ID}/a.png`),
      ).toThrow(BadRequestError);
    });
  });

  it("describes stored media from its blob properties", async () => {
    const { mediaService, blobService } = createLocalMediaService();
    const blobName = `postings/${USER_1_ID}/described.png`;
    await blobService.writeLocalBlob(blobName, Buffer.from("png"), "image/png");

    const media = await mediaService.getMedia(blobName);

    expect(media).toEqual({
      blobName,
      blobUrl: blobService.getBlobUrl(blobName),
      ownerId: USER_1_ID,
      contentType: "image/png",
      sizeBytes: 3,
      lastModified: expect.anything(),
    });
    expect(media.lastModified?.getTime()).toBeGreaterThan(0);
    await expect(
      mediaService.getMedia(`postings/${USER_1_ID}/missing.png`),
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("reports absent blob properties as null", async () => {
    const blobService = {
      getProperties: jest.fn(async () => ({})),
      getBlobUrl: jest.fn(() => "https://storage.test/general/file.png"),
      getBlobOwnerId: jest.fn(() => null),
    };
    const mediaService = new MediaService(
      blobService as unknown as BlobService,
    );

    await expect(mediaService.getMedia("general/file.png")).resolves.toEqual({
      blobName: "general/file.png",
      blobUrl: "https://storage.test/general/file.png",
      ownerId: null,
      contentType: null,
      sizeBytes: null,
      lastModified: null,
    });
  });

  it("reports storage availability and managed URLs from BlobService", () => {
    const { mediaService, blobService } = createLocalMediaService();
    const blobName = `general/${USER_1_ID}/a.png`;

    expect(mediaService.isConfigured()).toBe(true);
    expect(
      mediaService.isManagedUrl(blobService.getBlobUrl(blobName), blobName),
    ).toBe(true);
    expect(
      mediaService.isManagedUrl("https://example.test/a.png", blobName),
    ).toBe(false);
  });
});
