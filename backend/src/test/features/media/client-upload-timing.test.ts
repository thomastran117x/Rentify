import { parseClientUploadTiming } from "@/features/media/client-upload-timing";

describe("parseClientUploadTiming", () => {
  it("reads the upload and wait times and how the client noticed", () => {
    expect(parseClientUploadTiming("upload=1200, wait=900, via=push")).toEqual({
      uploadMs: 1_200,
      waitMs: 900,
      via: "push",
    });
    expect(parseClientUploadTiming("via=poll,wait=0,upload=600000")).toEqual({
      uploadMs: 600_000,
      waitMs: 0,
      via: "poll",
    });
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a missing field", "upload=1200, wait=900"],
    ["an unknown field", "upload=1200, wait=900, via=push, extra=1"],
    ["a repeated field", "upload=1, upload=2, via=push"],
    ["a field without a value", "upload, wait=900, via=push"],
    ["a field with two values", "upload=1=2, wait=900, via=push"],
    ["an unknown notice", "upload=1200, wait=900, via=email"],
    ["a negative time", "upload=-1, wait=900, via=push"],
    ["a fractional time", "upload=1.5, wait=900, via=push"],
    ["a time past the cap", "upload=600001, wait=900, via=push"],
    ["a time in another unit", "upload=1200ms, wait=900, via=push"],
    ["an oversized header", `upload=1, wait=1, via=push${" ".repeat(100)}`],
  ])("is null for %s", (_case, header) => {
    expect(parseClientUploadTiming(header)).toBeNull();
  });
});
