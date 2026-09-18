import { describe, expect, it } from "vitest";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_SIZE_BYTES,
  OVERSIZED_IMAGE_MESSAGE,
  UNSUPPORTED_IMAGE_MESSAGE,
  resolveImageContentType,
  validateImageFile,
} from "@/lib/blob/image-policy";

function file(name: string, type = "", bytes = 1): File {
  return new File([new Uint8Array(bytes)], name, type ? { type } : undefined);
}

describe("resolveImageContentType", () => {
  it("accepts the supported types the browser reports", () => {
    expect(resolveImageContentType(file("a.jpg", "image/jpeg"))).toBe(
      "image/jpeg",
    );
    expect(resolveImageContentType(file("a.png", "IMAGE/PNG"))).toBe(
      "image/png",
    );
    expect(resolveImageContentType(file("a.webp", "image/webp"))).toBe(
      "image/webp",
    );
  });

  it("rejects types outside the allow-list", () => {
    expect(
      resolveImageContentType(file("a.pdf", "application/pdf")),
    ).toBeNull();
    expect(resolveImageContentType(file("a.svg", "image/svg+xml"))).toBeNull();
    expect(resolveImageContentType(file("a.gif", "image/gif"))).toBeNull();
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(resolveImageContentType(file("photo.JPEG"))).toBe("image/jpeg");
    expect(resolveImageContentType(file("photo.png"))).toBe("image/png");
    expect(resolveImageContentType(file("photo.webp"))).toBe("image/webp");
  });

  it("rejects a typeless file with no usable extension", () => {
    expect(resolveImageContentType(file("unknown"))).toBeNull();
    expect(resolveImageContentType(file("archive.zip"))).toBeNull();
  });

  it("trusts the reported type over the extension", () => {
    // The server derives the stored extension from the content type, so a
    // disagreement here is harmless - the declared type is what counts.
    expect(resolveImageContentType(file("photo.png", "image/jpeg"))).toBe(
      "image/jpeg",
    );
  });
});

describe("validateImageFile", () => {
  it("accepts a supported file within the size limit", () => {
    expect(validateImageFile(file("a.png", "image/png"))).toBeNull();
  });

  it("reports unsupported files", () => {
    expect(validateImageFile(file("a.pdf", "application/pdf"))).toBe(
      UNSUPPORTED_IMAGE_MESSAGE,
    );
  });

  it("reports oversized files", () => {
    expect(
      validateImageFile(file("a.png", "image/png", MAX_IMAGE_SIZE_BYTES + 1)),
    ).toBe(OVERSIZED_IMAGE_MESSAGE);
  });
});

describe("IMAGE_ACCEPT_ATTRIBUTE", () => {
  it("lists exactly the allowed types", () => {
    expect(IMAGE_ACCEPT_ATTRIBUTE).toBe("image/jpeg,image/png,image/webp");
  });
});
