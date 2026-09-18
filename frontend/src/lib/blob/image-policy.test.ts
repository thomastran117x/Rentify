import { describe, expect, it } from "vitest";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  resolveUploadContentType,
} from "@/lib/blob/image-policy";

function file(name: string, type = ""): File {
  return new File([new Uint8Array(1)], name, type ? { type } : undefined);
}

describe("resolveUploadContentType", () => {
  it("declares the type the browser reports, normalised", () => {
    expect(resolveUploadContentType(file("a.jpg", "image/jpeg"))).toBe(
      "image/jpeg",
    );
    expect(resolveUploadContentType(file("a.png", " IMAGE/PNG "))).toBe(
      "image/png",
    );
  });

  it("passes unsupported types through for the server to reject", () => {
    // The client does not judge acceptability; the server's 415 names the
    // formats this deployment actually allows.
    expect(resolveUploadContentType(file("a.pdf", "application/pdf"))).toBe(
      "application/pdf",
    );
    expect(resolveUploadContentType(file("a.svg", "image/svg+xml"))).toBe(
      "image/svg+xml",
    );
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(resolveUploadContentType(file("photo.JPEG"))).toBe("image/jpeg");
    expect(resolveUploadContentType(file("photo.png"))).toBe("image/png");
    expect(resolveUploadContentType(file("photo.webp"))).toBe("image/webp");
  });

  it("declares octet-stream when neither type nor extension helps", () => {
    expect(resolveUploadContentType(file("unknown"))).toBe(
      "application/octet-stream",
    );
    expect(resolveUploadContentType(file("archive.zip"))).toBe(
      "application/octet-stream",
    );
  });

  it("trusts the reported type over the extension", () => {
    // The server derives the stored extension from the declared type, so a
    // disagreement here is harmless.
    expect(resolveUploadContentType(file("photo.png", "image/jpeg"))).toBe(
      "image/jpeg",
    );
  });
});

describe("IMAGE_ACCEPT_ATTRIBUTE", () => {
  it("offers the full built-in set as a picker hint", () => {
    expect(IMAGE_ACCEPT_ATTRIBUTE).toBe("image/jpeg,image/png,image/webp");
  });
});
