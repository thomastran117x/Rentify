import type { SupportedImageContentType } from "@/configuration/environment/constants";
import {
  IMAGE_DECODE_FAIL_ON,
  assertImageNotEmpty,
  assertImageSizeWithinLimit,
  decodeUprightImage,
  formatByteLimit,
  inspectImageHeader,
  isImagePolicyRejection,
  isUndecodableImageError,
  normalizeImageContentType,
  rejectionCodeOf,
} from "@/features/media/image-policy";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import UnprocessableEntityError from "@/errors/http/unprocessable-entity.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";
import sharp from "sharp";
import {
  appendTrailingBytes,
  corruptImageTail,
  createAnimatedWebpFixture,
  createApngFixture,
  createGifFixture,
  createJpegFixture,
  createJpegWithExtraneousBytesFixture,
  createPngFixture,
  createSingleFrameAnimatedWebpFixture,
  createWebpFixture,
  truncateImage,
} from "../../support/image-fixtures";

const POLICY_VARIABLES = [
  "ALLOWED_IMAGE_TYPES",
  "MAX_IMAGE_SIZE_BYTES",
  "MAX_IMAGE_WIDTH",
  "MAX_IMAGE_HEIGHT",
  "MAX_IMAGE_PIXELS",
  "MAX_PROCESSED_IMAGE_EDGE",
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
      rejectionCode: "unsupported_type",
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

describe("assertImageNotEmpty", () => {
  it("rejects an empty upload and accepts anything else", () => {
    expect(() => assertImageNotEmpty(0)).toThrow(UnprocessableEntityError);
    expect(() => assertImageNotEmpty(0)).toThrow("The uploaded file is empty.");
    expect(() => assertImageNotEmpty(1)).not.toThrow();
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

/**
 * Both passes over an upload's bytes, as processing runs them: the header
 * checks, then the decode, which is what proves the pixel data whole.
 */
async function assertImageBytes(
  body: Buffer,
  declaredContentType: SupportedImageContentType,
): Promise<SupportedImageContentType> {
  const detected = await inspectImageHeader(body, declaredContentType);
  await decodeUprightImage(body);
  return detected;
}

/**
 * An image with real detail, so its pixel data far outweighs its header and
 * damage lands in the data. Random, but only the damage matters here.
 */
async function createNoisyFixture(
  format: "jpeg" | "png" | "webp",
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      // Typed as required, though the noise replaces it.
      background: "#000000",
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

describe("decodeUprightImage", () => {
  it("decodes upright, fitted inside the processed edge and never enlarged", async () => {
    process.env.MAX_PROCESSED_IMAGE_EDGE = "256";
    const rotated = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#2878c8" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    await expect(decodeUprightImage(rotated)).resolves.toMatchObject({
      width: 192,
      height: 256,
      channels: 3,
    });
    const small = await decodeUprightImage(await createPngFixture(12, 8));
    expect(small).toMatchObject({ width: 12, height: 8, channels: 3 });
    expect(small.data.byteLength).toBe(12 * 8 * 3);
  });

  // The decoders shrink a large image while they read it, which the small
  // fixtures elsewhere never trigger: 2048 wide into a 256 edge is eight times.
  it.each(["jpeg", "png", "webp"] as const)(
    "still rejects truncated %s data while shrinking it on load",
    async (format) => {
      process.env.MAX_PROCESSED_IMAGE_EDGE = "256";
      const image = await createNoisyFixture(format, 2048, 1536);

      await expect(decodeUprightImage(image)).resolves.toMatchObject({
        width: 256,
        height: 192,
      });
      for (const damaged of [
        truncateImage(image),
        truncateImage(image, 0.95),
        image.subarray(0, image.length - 16),
      ]) {
        await expect(decodeUprightImage(damaged)).rejects.toThrow(
          "Uploaded image data is truncated or corrupt.",
        );
      }
    },
  );

  it("names the refusal as corrupt", async () => {
    const error = await decodeUprightImage(
      truncateImage(await createPngFixture(64, 64)),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UnsupportedMediaTypeError);
    expect(rejectionCodeOf(error as UnsupportedMediaTypeError)).toBe("corrupt");
  });

  it("throws a failure that is not the image's fault as it is, for a retry", async () => {
    // Built first: the spy below would fail its encode too.
    const image = await createPngFixture(64, 64);
    const outOfMemory = new Error("out of memory --- size == 16MB");
    const toBuffer = jest
      .spyOn(sharp.prototype, "toBuffer")
      .mockRejectedValueOnce(outOfMemory);

    try {
      await expect(decodeUprightImage(image)).rejects.toBe(outOfMemory);
    } finally {
      toBuffer.mockRestore();
    }
  });
});

describe("isUndecodableImageError", () => {
  // What libvips and sharp said for each damaged fixture the decode tests use.
  it.each([
    "VipsJpeg: premature end of JPEG image",
    "vipspng: libpng read error",
    "Input buffer has corrupt header: webp: unable to parse image",
    "Input buffer contains unsupported image format",
    "Input image exceeds pixel limit",
    "webp2vips: unable to read pixels\nwebpload_buffer: load error",
    "jpegload: out of order read at line 12",
  ])("blames the image for %j", (message) => {
    expect(isUndecodableImageError(new Error(message))).toBe(true);
  });

  it.each([
    "out of memory --- size == 16MB",
    "VipsJpeg: out of memory",
    "Array buffer allocation failed",
    "Could not allocate memory",
    "vips_resize: operation cancelled",
    "something unexpected",
  ])("blames the worker for %j", (message) => {
    expect(isUndecodableImageError(new Error(message))).toBe(false);
  });

  it("reads a thrown value that is not an Error", () => {
    expect(isUndecodableImageError("vipspng: libpng read error")).toBe(true);
  });
});

describe("inspectImageHeader and decodeUprightImage", () => {
  it("accepts bytes whose real format matches the declared type", async () => {
    await expect(
      assertImageBytes(await createPngFixture(6, 3), "image/png"),
    ).resolves.toBe("image/png");
    await expect(
      assertImageBytes(await createJpegFixture(), "image/jpeg"),
    ).resolves.toBe("image/jpeg");
    await expect(
      assertImageBytes(await createWebpFixture(), "image/webp"),
    ).resolves.toBe("image/webp");
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

  it("rejects an animated image as final", async () => {
    const error = await assertImageBytes(
      await createAnimatedWebpFixture(3),
      "image/webp",
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UnprocessableEntityError);
    expect((error as UnprocessableEntityError).message).toBe(
      "Animated or multi-page images are not supported.",
    );
    expect((error as UnprocessableEntityError).details).toEqual({
      pages: 3,
      rejectionCode: "animated",
    });
    expect(isImagePolicyRejection(error)).toBe(true);
  });

  it("accepts a single-frame image in an animated container", async () => {
    const webp = await createSingleFrameAnimatedWebpFixture();

    await expect(sharp(webp).metadata()).resolves.toMatchObject({ pages: 1 });
    await expect(assertImageBytes(webp, "image/webp")).resolves.toBe(
      "image/webp",
    );
  });

  it("accepts an APNG as the static PNG libvips reads it as", async () => {
    const apng = await createApngFixture();

    // The precondition behind accepting APNG: libvips does not report its
    // frames. If sharp starts to, the pages check will reject it and this test
    // should be revisited rather than deleted.
    const metadata = await sharp(apng).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.pages).toBeUndefined();

    await expect(assertImageBytes(apng, "image/png")).resolves.toBe(
      "image/png",
    );
  });

  it("rejects images exceeding the total pixel budget", async () => {
    const oversized = await createPngFixture(64, 64);
    process.env.MAX_IMAGE_PIXELS = "256";

    await expect(assertImageBytes(oversized, "image/png")).rejects.toThrow(
      UnprocessableEntityError,
    );
  });
});

describe("decode strictness", () => {
  it("accepts a JPEG that libjpeg recovers from with a warning", async () => {
    const jpeg = await createJpegWithExtraneousBytesFixture();

    expect(IMAGE_DECODE_FAIL_ON).toBe("error");
    await expect(assertImageBytes(jpeg, "image/jpeg")).resolves.toBe(
      "image/jpeg",
    );
    // Why the level is not "warning": it refuses this usable image.
    await expect(sharp(jpeg, { failOn: "warning" }).stats()).rejects.toThrow(
      /extraneous bytes/,
    );
  });

  it("accepts bytes after the end of the image", async () => {
    for (const [body, contentType] of [
      [appendTrailingBytes(await createJpegFixture(16, 16)), "image/jpeg"],
      [appendTrailingBytes(await createPngFixture(16, 16)), "image/png"],
      [appendTrailingBytes(await createWebpFixture(16, 16)), "image/webp"],
    ] as const) {
      await expect(assertImageBytes(body, contentType)).resolves.toBe(
        contentType,
      );
    }
  });

  it("still rejects a JPEG cut short", async () => {
    // A flat test JPEG is mostly header, so cut only the end of its scan.
    const jpeg = await createJpegFixture(64, 64);

    await expect(
      assertImageBytes(jpeg.subarray(0, jpeg.length - 16), "image/jpeg"),
    ).rejects.toThrow("Uploaded image data is truncated or corrupt.");
  });
});

describe("isImagePolicyRejection", () => {
  it("recognises exactly the errors the policy refuses an image with", async () => {
    const refusals = await Promise.all([
      assertImageBytes(Buffer.from("not-an-image"), "image/png").catch(
        (error: unknown) => error,
      ),
      Promise.resolve().then(() => {
        try {
          assertImageSizeWithinLimit(-1);
        } catch (error) {
          return error;
        }
      }),
      Promise.resolve().then(() => {
        try {
          normalizeImageContentType("application/pdf");
        } catch (error) {
          return error;
        }
      }),
    ]);

    for (const refusal of refusals) {
      expect(isImagePolicyRejection(refusal)).toBe(true);
    }
    expect(isImagePolicyRejection(new PayloadTooLargeError("too big"))).toBe(
      true,
    );
    expect(isImagePolicyRejection(new Error("storage unavailable"))).toBe(
      false,
    );
    expect(isImagePolicyRejection("nope")).toBe(false);
  });
});

describe("rejection codes", () => {
  async function codeOf(check: () => unknown): Promise<string> {
    try {
      await check();
    } catch (error) {
      expect(isImagePolicyRejection(error)).toBe(true);
      return rejectionCodeOf(error as UnprocessableEntityError);
    }

    throw new Error("The check did not refuse.");
  }

  it("names one on every refusal", async () => {
    process.env.ALLOWED_IMAGE_TYPES = "image/png,image/webp";
    process.env.MAX_IMAGE_SIZE_BYTES = "1024";
    process.env.MAX_IMAGE_WIDTH = "16";

    await expect(
      codeOf(() => normalizeImageContentType("image/jpeg")),
    ).resolves.toBe("unsupported_type");
    await expect(codeOf(() => assertImageSizeWithinLimit(2048))).resolves.toBe(
      "too_large",
    );
    await expect(codeOf(() => assertImageSizeWithinLimit(-1))).resolves.toBe(
      "corrupt",
    );
    await expect(codeOf(() => assertImageNotEmpty(0))).resolves.toBe("empty");
    await expect(
      codeOf(() => assertImageBytes(Buffer.from("nope"), "image/png")),
    ).resolves.toBe("corrupt");
    await expect(
      codeOf(async () =>
        assertImageBytes(await createWebpFixture(), "image/png"),
      ),
    ).resolves.toBe("type_mismatch");
    await expect(
      codeOf(async () =>
        assertImageBytes(await createAnimatedWebpFixture(2), "image/webp"),
      ),
    ).resolves.toBe("animated");
    await expect(
      codeOf(async () =>
        assertImageBytes(await createPngFixture(32, 8), "image/png"),
      ),
    ).resolves.toBe("dimensions");
    await expect(
      codeOf(async () =>
        assertImageBytes(
          truncateImage(await createPngFixture(12, 12)),
          "image/png",
        ),
      ),
    ).resolves.toBe("corrupt");
  });

  it("counts a refusal without a recognised code as undecodable", () => {
    expect(rejectionCodeOf(new UnprocessableEntityError("Bare."))).toBe(
      "corrupt",
    );
    expect(
      rejectionCodeOf(
        new PayloadTooLargeError("Unknown.", { rejectionCode: "unheard_of" }),
      ),
    ).toBe("corrupt");
  });
});
