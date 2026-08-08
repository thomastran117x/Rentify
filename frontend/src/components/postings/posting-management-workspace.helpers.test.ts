import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { PostingRecord } from "@/lib/postings/api";

const { createUploadUrlMock } = vi.hoisted(() => ({
  createUploadUrlMock: vi.fn(),
}));

vi.mock("@/lib/blob/api", () => ({
  blobApi: { createUploadUrl: createUploadUrlMock },
}));

import {
  buildLifecycleActions,
  buildPayload,
  createDefaultDetails,
  createDefaultFormState,
  getCompletenessItems,
  photoItemsFromPosting,
  readValidationDetails,
  safeFormatPrice,
  toFormState,
  uploadManagedPhoto,
  validateStep,
} from "./posting-management-workspace";

function posting(overrides: Partial<PostingRecord> = {}): PostingRecord {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "draft",
    variant: { family: "place", subtype: "workspace" },
    name: "Studio",
    description: "A studio",
    pricing: { currency: "CAD", daily: { amount: 100 } },
    pricingCurrency: "CAD",
    photos: [],
    tags: ["studio"],
    details: {},
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 14,
    availabilityBlocks: [],
    location: {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      latitude: 43.6,
      longitude: -79.3,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as PostingRecord;
}

describe("posting management helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds defaults for every posting family and subtype branch", () => {
    expect(createDefaultDetails("place", "workspace")).toMatchObject({
      property_type: "studio",
      parking: false,
    });
    expect(createDefaultDetails("place", "apartment")).toMatchObject({
      property_type: "loft",
    });
    expect(createDefaultDetails("equipment", "camera")).toMatchObject({
      condition: "excellent",
      includes_delivery: false,
    });
    expect(createDefaultDetails("vehicle", "car")).toMatchObject({
      seats: 5,
      license_class: "G",
    });
    expect(createDefaultDetails("vehicle", "bike")).toMatchObject({
      seats: 1,
      license_class: "standard",
    });
  });

  it("normalizes present and absent optional posting fields", () => {
    const empty = toFormState(posting());
    expect(empty).toMatchObject({
      availabilityNotes: "",
      minBookingDurationDays: "",
      advanceNoticeDays: "",
      cancellationPolicy: "",
      cancellationPolicyNotes: "",
      instantBooking: false,
      postalCode: "",
    });

    const populated = toFormState(
      posting({
        availabilityNotes: "Weekdays",
        maxBookingDurationDays: 30,
        minBookingDurationDays: 2,
        advanceNoticeDays: 3,
        cancellationPolicy: "moderate",
        cancellationPolicyNotes: "48 hours",
        instantBooking: true,
        location: {
          city: "Ottawa",
          region: "Ontario",
          country: "Canada",
          postalCode: "K1A 0B1",
          latitude: 45.4,
          longitude: -75.7,
        },
      }),
    );
    expect(populated).toMatchObject({
      availabilityNotes: "Weekdays",
      maxBookingDurationDays: "30",
      minBookingDurationDays: "2",
      advanceNoticeDays: "3",
      cancellationPolicy: "moderate",
      cancellationPolicyNotes: "48 hours",
      instantBooking: true,
      postalCode: "K1A 0B1",
    });
  });

  it("sorts existing photos and prefers thumbnails", () => {
    const items = photoItemsFromPosting(
      posting({
        photos: [
          {
            id: "photo-2",
            blobName: "second.jpg",
            blobUrl: "https://blob/second.jpg",
            position: 2,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
          {
            id: "photo-1",
            blobName: "first.jpg",
            blobUrl: "https://blob/first.jpg",
            thumbnailBlobUrl: "https://blob/thumb.jpg",
            position: 0,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
      }),
    );
    expect(items.map((item) => item.previewUrl)).toEqual([
      "https://blob/thumb.jpg",
      "https://blob/second.jpg",
    ]);
  });

  it("builds payloads with both blank and populated optional settings", () => {
    const form = createDefaultFormState();
    form.name = "  Studio  ";
    form.description = "  Description  ";
    form.currency = " cad ";
    form.tags = [" one ", " ", "two"];
    form.availabilityNotes = "";
    form.maxBookingDurationDays = "";
    form.minBookingDurationDays = "";
    form.advanceNoticeDays = "";
    form.cancellationPolicy = "";
    form.cancellationPolicyNotes = "";
    form.postalCode = "";
    const photos = [{ blobUrl: "https://blob/a", blobName: "a", position: 0 }];

    expect(buildPayload(form, photos)).toMatchObject({
      name: "Studio",
      description: "Description",
      tags: ["one", "two"],
      availabilityNotes: null,
      maxBookingDurationDays: null,
      minBookingDurationDays: null,
      advanceNoticeDays: null,
      cancellationPolicy: null,
      cancellationPolicyNotes: null,
      location: { postalCode: null },
    });

    Object.assign(form, {
      availabilityNotes: "Available mornings",
      maxBookingDurationDays: "9",
      minBookingDurationDays: "2",
      advanceNoticeDays: "1",
      cancellationPolicy: "strict",
      cancellationPolicyNotes: "No refunds",
      postalCode: "M5V 2T6",
    });
    expect(buildPayload(form, photos)).toMatchObject({
      availabilityNotes: "Available mornings",
      maxBookingDurationDays: 9,
      minBookingDurationDays: 2,
      advanceNoticeDays: 1,
      cancellationPolicy: "strict",
      cancellationPolicyNotes: "No refunds",
      location: { postalCode: "M5V 2T6" },
    });
    expect(() => buildPayload(form, [])).toThrow("Upload at least one photo");
  });

  it("uploads photos with explicit and fallback content types", async () => {
    createUploadUrlMock.mockResolvedValue({
      method: "PUT",
      uploadUrl: "https://upload",
      headers: {},
      blobUrl: "https://blob/photo",
      blobName: "photo",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(
      uploadManagedPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" })),
    ).resolves.toMatchObject({ blobName: "photo", position: 0 });
    await uploadManagedPhoto(new File(["a"], "unknown"));
    expect(createUploadUrlMock).toHaveBeenNthCalledWith(2, {
      filename: "unknown",
      contentType: "application/octet-stream",
      scope: "postings",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    await expect(
      uploadManagedPhoto(new File(["a"], "bad.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow("Photo upload failed");
  });

  it("reports completeness for both incomplete and complete drafts", () => {
    const form = createDefaultFormState();
    form.description = "short";
    form.tags = [];
    form.cancellationPolicy = "";
    form.availabilityNotes = "";
    form.minBookingDurationDays = "";
    form.maxBookingDurationDays = "";
    form.advanceNoticeDays = "";
    expect(getCompletenessItems(form, 0).every((item) => !item.done)).toBe(
      true,
    );

    form.description = "x".repeat(100);
    form.tags = ["one", "two"];
    form.cancellationPolicy = "flexible";
    form.availabilityNotes = "notes";
    form.minBookingDurationDays = "1";
    form.maxBookingDurationDays = "10";
    form.advanceNoticeDays = "2";
    expect(getCompletenessItems(form, 3).every((item) => item.done)).toBe(true);
  });

  it("returns lifecycle actions for each status", () => {
    expect(buildLifecycleActions("draft").map((action) => action.id)).toEqual([
      "publish",
      "archive",
    ]);
    expect(
      buildLifecycleActions("published").map((action) => action.id),
    ).toEqual(["pause", "archive"]);
    expect(buildLifecycleActions("paused").map((action) => action.id)).toEqual([
      "unpause",
      "archive",
    ]);
    expect(buildLifecycleActions("archived")).toEqual([]);
  });

  it("validates every wizard step and accepts valid values", () => {
    const form = createDefaultFormState();
    form.name = "";
    form.description = "";
    expect(validateStep("basics", form, 0)).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
    });
    form.name = "Studio";
    form.description = "Description";
    expect(validateStep("basics", form, 0)).toEqual({});

    for (const values of [
      { city: "", region: "", country: "", latitude: "", longitude: "" },
      {
        city: "T",
        region: "O",
        country: "C",
        latitude: "bad",
        longitude: "bad",
      },
      {
        city: "T",
        region: "O",
        country: "C",
        latitude: "91",
        longitude: "181",
      },
      {
        city: "T",
        region: "O",
        country: "C",
        latitude: "-91",
        longitude: "-181",
      },
    ]) {
      Object.assign(form, values);
      expect(
        Object.keys(validateStep("location", form, 0)).length,
      ).toBeGreaterThan(0);
    }
    Object.assign(form, {
      city: "T",
      region: "O",
      country: "C",
      latitude: "45",
      longitude: "-75",
    });
    expect(validateStep("location", form, 0)).toEqual({});

    for (const amount of ["", "bad", "0", "-1"]) {
      form.dailyPriceAmount = amount;
      form.currency = "";
      expect(validateStep("pricing", form, 0)).toMatchObject({
        dailyPriceAmount: expect.any(String),
        currency: expect.any(String),
      });
    }
    form.dailyPriceAmount = "100";
    form.currency = "CAD";
    expect(validateStep("pricing", form, 0)).toEqual({});

    for (const value of ["1.5", "-1", "bad"]) {
      form.maxBookingDurationDays = value;
      form.minBookingDurationDays = value;
      form.advanceNoticeDays = value;
      expect(Object.keys(validateStep("availability", form, 0))).toHaveLength(
        3,
      );
    }
    form.maxBookingDurationDays = "";
    form.minBookingDurationDays = "";
    form.advanceNoticeDays = "";
    expect(validateStep("availability", form, 0)).toEqual({});
    expect(validateStep("details", form, 0)).toHaveProperty("photos");
    expect(validateStep("details", form, 1)).toEqual({});
    expect(validateStep("category", form, 0)).toEqual({});
  });

  it("filters malformed validation details", () => {
    expect(readValidationDetails(new Error("plain"))).toEqual([]);
    const error = new ApiClientError("Invalid", {
      status: 400,
      code: "VALIDATION_ERROR",
      request: { method: "POST", path: "/postings", requestUrl: "/postings" },
      details: [
        null,
        "bad",
        { path: "name", message: " Required " },
        { path: 42, message: "No path" },
        { path: "description", message: " " },
        { path: "tags", message: 42 },
      ],
    });
    expect(readValidationDetails(error)).toEqual([
      { path: "name", message: "Required" },
      { path: "", message: "No path" },
    ]);
  });

  it("formats valid and invalid preview prices", () => {
    expect(safeFormatPrice("not-a-number", "cad")).toBe("not-a-number CAD");
    expect(safeFormatPrice("10", "c")).toBe("10 C");
    expect(safeFormatPrice("10", "CAD")).toContain("10");
    expect(safeFormatPrice("", "")).toBe("0");
  });
});
