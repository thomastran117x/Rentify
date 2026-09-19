import {
  assertImageBytes,
  assertImageSizeWithinLimit,
  formatByteLimit,
  imageExtensionForContentType,
  normalizeImageContentType,
} from "@/features/media/image-policy";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import UnprocessableEntityError from "@/errors/http/unprocessable-entity.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";
import sharp from "sharp";
import {
  corruptImageTail,
  createGifFixture,
  createJpegFixture,
  createPngFixture,
  createWebpFixture,
  truncateImage,
} from "../../support/image-fixtures";

const POLICY_VARIABLES = [
  "ALLOWED_IMAGE_TYPES",
  "MAX_IMAGE_SIZE_BYTES",
  "MAX_IMAGE_WIDTH",
  "MAX_IMAGE_HEIGHT",
  "MAX_IMAGE_PIXELS",
] as const;

const originalValues = new Map(
  POLICY_VARIABLES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of POLICY_VARIABLES) {
    const value = originalValues.get(name);

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("normalizeImageContentType", () => {
  it("accepts the supported image types and normalizes casing and padding", () => {
    expect(normalizeImageContentType("image/jpeg")).toBe("image/jpeg");
    expect(normalizeImageContentType("  IMAGE/PNG  ")).toBe("image/png");
    expect(normalizeImageContentType("Image/WebP")).toBe("image/webp");
  });

  it("rejects non-image and excluded image types", () => {
    for (const contentType of [
      "application/pdf",
      "text/html",
      "application/octet-stream",
      "image/svg+xml",
      "image/gif",
      "image/tiff",
      "image/heic",
    ]) {
      expect(() => normalizeImageContentType(contentType)).toThrow(
        UnsupportedMediaTypeError,
      );
    }
  });

  it("rejects malformed content types", () => {
    for (const contentType of [
      "",
      "   ",
      "image",
      "image/",
      "image/png; charset=utf-8",
      "image/png\r\nx-injected: yes",
    ]) {
      expect(() => normalizeImageContentType(contentType)).toThrow(
        UnsupportedMediaTypeError,
      );
    }
  });

  it("rejects a supported type that the deployment has excluded", () => {
    process.env.ALLOWED_IMAGE_TYPES = "image/png";

    expect(normalizeImageContentType("image/png")).toBe("image/png");
    expect(() => normalizeImageContentType("image/jpeg")).toThrow(
      UnsupportedMediaTypeError,
    );
  });

  it("reports the configured allow-list in the error details", () => {
    process.env.ALLOWED_IMAGE_TYPES = "image/png,image/webp";

    const error = (() => {
      try {
        normalizeImageContentType("application/pdf");
        return null;
      } catch (thrown) {
        return thrown as UnsupportedMediaTypeError;
      }
    })();

    expect(error).toBeInstanceOf(UnsupportedMediaTypeError);
    expect(error?.status).toBe(415);
    expect(error?.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(error?.details).toEqual({
      allowedContentTypes: ["image/png", "image/webp"],
      received: "application/pdf",
    });
  });
});

describe("rejection messages", () => {
  it("names exactly the formats the deployment accepts", () => {
    const messageFor = () => {
      try {
        normalizeImageContentType("application/pdf");
        return null;
      } catch (thrown) {
        return (thrown as Error).message;
      }
    };

    expect(messageFor()).toBe(
      "Only JPEG, PNG, and WebP images can be uploaded.",
    );

    process.env.ALLOWED_IMAGE_TYPES = "image/png,image/webp";
    expect(messageFor()).toBe("Only PNG and WebP images can be uploaded.");

    process.env.ALLOWED_IMAGE_TYPES = "image/png";
    expect(messageFor()).toBe("Only PNG images can be uploaded.");
  });

  it("states the configured size ceiling", () => {
    process.env.MAX_IMAGE_SIZE_BYTES = String(8 * 1024 * 1024);
    expect(() => assertImageSizeWithinLimit(9 * 1024 * 1024)).toThrow(
      "Images must be 8 MB or smaller.",
    );

    process.env.MAX_IMAGE_SIZE_BYTES = "1024";
    expect(() => assertImageSizeWithinLimit(2048)).toThrow(
      "Images must be 1 KB or smaller.",
    );
  });

  it("formats byte limits for people", () => {
    expect(formatByteLimit(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatByteLimit(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatByteLimit(512 * 1024)).toBe("512 KB");
    expect(formatByteLimit(900)).toBe("900 bytes");
  });
});

describe("imageExtensionForContentType", () => {
  it("maps each supported type to its canonical extension", () => {
    expect(imageExtensionForContentType("image/jpeg")).toBe(".jpg");
    expect(imageExtensionForContentType("image/png")).toBe(".png");
    expect(imageExtensionForContentType("image/webp")).toBe(".webp");
  });
});

describe("assertImageSizeWithinLimit", () => {
  it("accepts sizes at or below the limit", () => {
    process.env.MAX_IMAGE_SIZE_BYTES = "1024";

    expect(() => assertImageSizeWithinLimit(0)).not.toThrow();
    expect(() => assertImageSizeWithinLimit(1024)).not.toThrow();
  });

  it("rejects sizes above the limit", () => {
    process.env.MAX_IMAGE_SIZE_BYTES = "1024";

    expect(() => assertImageSizeWithinLimit(1025)).toThrow(
      PayloadTooLargeError,
    );
  });

  it("rejects nonsensical sizes", () => {
    expect(() => assertImageSizeWithinLimit(-1)).toThrow(
      UnprocessableEntityError,
    );
    expect(() => assertImageSizeWithinLimit(Number.NaN)).toThrow(
      UnprocessableEntityError,
    );
  });
});

describe("assertImageBytes", () => {
  it("accepts bytes whose real format matches the declared type", async () => {
    await expect(
      assertImageBytes(await createPngFixture(), "image/png"),
    ).resolves.toBeUndefined();
    await expect(
      assertImageBytes(await createJpegFixture(), "image/jpeg"),
    ).resolves.toBeUndefined();
    await expect(
      assertImageBytes(await createWebpFixture(), "image/webp"),
    ).resolves.toBeUndefined();
  });

  it("rejects bytes that are not an image at all", async () => {
    await expect(
      assertImageBytes(Buffer.from("definitely-not-an-image"), "image/png"),
    ).rejects.toThrow("Uploaded file could not be read as an image.");
  });

  it("rejects a real image whose format contradicts the declared type", async () => {
    await expect(
      assertImageBytes(await createJpegFixture(), "image/png"),
    ).rejects.toThrow(
      "Uploaded file contents do not match the declared image type.",
    );
  });

  it("rejects a decodable format that the policy excludes", async () => {
    // sharp reads GIFs happily; the allow-list is what keeps them out.
    await expect(
      assertImageBytes(await createGifFixture(), "image/png"),
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it("rejects images wider or taller than the configured maximum", async () => {
    process.env.MAX_IMAGE_WIDTH = "16";
    process.env.MAX_IMAGE_HEIGHT = "16";

    await expect(
      assertImageBytes(await createPngFixture(64, 8), "image/png"),
    ).rejects.toThrow("Image dimensions exceed the allowed maximum.");
    await expect(
      assertImageBytes(await createPngFixture(8, 64), "image/png"),
    ).rejects.toThrow(UnprocessableEntityError);
  });

  it("rejects a valid header over truncated or corrupt pixel data", async () => {
    // Larger than the 4x4 default so the pixel data outweighs the header and
    // truncation lands inside it.
    const png = await createPngFixture(64, 64);
    const webp = await createWebpFixture(64, 64);
    const truncatedPng = truncateImage(png);
    const corruptWebp = corruptImageTail(webp);

    // The precondition this test depends on: the header alone looks fine. If
    // sharp ever starts rejecting these at metadata(), this test stops proving
    // anything and should be revisited rather than deleted.
    await expect(sharp(truncatedPng).metadata()).resolves.toMatchObject({
      format: "png",
      width: 64,
      height: 64,
    });
    await expect(sharp(corruptWebp).metadata()).resolves.toMatchObject({
      format: "webp",
    });

    for (const [body, contentType] of [
      [truncatedPng, "image/png"],
      [corruptImageTail(png), "image/png"],
      [corruptWebp, "image/webp"],
    ] as const) {
      await expect(assertImageBytes(body, contentType)).rejects.toThrow(
        "Uploaded image data is truncated or corrupt.",
      );
    }
  });

  it("rejects images exceeding the total pixel budget", async () => {
    const oversized = await createPngFixture(64, 64);
    process.env.MAX_IMAGE_PIXELS = "256";

    await expect(assertImageBytes(oversized, "image/png")).rejects.toThrow(
      UnprocessableEntityError,
    );
  });
});
