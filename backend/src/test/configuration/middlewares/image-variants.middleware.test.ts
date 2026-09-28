import { imageVariantsMiddleware } from "@/configuration/middlewares/image-variants.middleware";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import {
  ImageVariantsResolver,
  referenceImageVariants,
} from "@/features/media/image-variants";
import type { RecordedRenditions } from "@/features/media/media.model";
import { createTestApp } from "../../support/fetch-app";

const BLOB_NAME = "media/images/owner-1/photo-1.webp";
const BLOB_URL = `https://cdn.test/uploads/${BLOB_NAME}`;
const RECORDED: RecordedRenditions = {
  width: 1600,
  height: 1200,
  variants: {
    medium: { width: 800, height: 600, sizeBytes: 2 },
    thumbnail: { width: 300, height: 225, sizeBytes: 1 },
  },
};

function createApp(findRecordedRenditions: jest.Mock) {
  const resolver = new ImageVariantsResolver({ findRecordedRenditions });

  return createTestApp((app) => {
    app.use((request, _response, next) => {
      request.container = { resolve: () => resolver } as any;
      next();
    });
    app.use(outputFormatMiddleware);
    app.use(imageVariantsMiddleware);

    app.get("/plain", (_request, response) => {
      response.json({ id: "posting-1", primaryPhotoVariants: null });
    });
    app.get("/photo", (_request, response) => {
      response.status(201).json({
        id: "posting-1",
        primaryPhotoVariants: referenceImageVariants(BLOB_NAME, BLOB_URL),
      });
    });
  });
}

describe("imageVariantsMiddleware", () => {
  it("writes a response without references as it is, with no lookup", async () => {
    const findRecordedRenditions = jest.fn();
    const app = createApp(findRecordedRenditions);

    const response = await app.request("http://rent.test/plain");

    await expect(response.json()).resolves.toEqual({
      id: "posting-1",
      primaryPhotoVariants: null,
    });
    expect(findRecordedRenditions).not.toHaveBeenCalled();
  });

  it("resolves every reference in one lookup before writing", async () => {
    const findRecordedRenditions = jest.fn(
      async () => new Map([[BLOB_NAME, RECORDED]]),
    );
    const app = createApp(findRecordedRenditions);

    const response = await app.request("http://rent.test/photo");

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "posting-1",
      primaryPhotoVariants: {
        thumbnail: {
          url: "https://cdn.test/uploads/media/images/owner-1/photo-1.thumbnail.webp",
          width: 300,
          height: 225,
        },
        medium: {
          url: "https://cdn.test/uploads/media/images/owner-1/photo-1.medium.webp",
          width: 800,
          height: 600,
        },
        large: { url: BLOB_URL, width: 1600, height: 1200 },
      },
    });
    expect(findRecordedRenditions).toHaveBeenCalledTimes(1);
    expect(findRecordedRenditions).toHaveBeenCalledWith([BLOB_NAME]);
  });

  it("resolves the references in a response transcoded to XML", async () => {
    const app = createApp(
      jest.fn(async () => new Map([[BLOB_NAME, RECORDED]])),
    );

    const response = await app.request("http://rent.test/photo?format=xml");
    const body = await response.text();

    expect(body).toContain(
      "<url>https://cdn.test/uploads/media/images/owner-1/photo-1.medium.webp</url>",
    );
    expect(body).not.toContain("imageVariants");
  });

  it("sends the response with no renditions when the lookup fails", async () => {
    const app = createApp(
      jest.fn(async () => {
        throw new Error("database unavailable");
      }),
    );

    const response = await app.request("http://rent.test/photo");

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "posting-1",
      primaryPhotoVariants: null,
    });
  });
});
