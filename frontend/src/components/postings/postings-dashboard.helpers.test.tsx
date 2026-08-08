import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PostingRecord } from "@/lib/postings/api";
import {
  PostingThumb,
  formatDate,
  formatVariant,
  lifecycleActions,
  primaryPhotoUrl,
  safePrice,
} from "./postings-dashboard";

function posting(overrides: Partial<PostingRecord> = {}): PostingRecord {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "draft",
    name: "Studio",
    variant: { family: "place", subtype: "private_room" },
    pricing: { currency: "CAD", daily: { amount: 100 } },
    pricingCurrency: "CAD",
    location: { city: "Toronto", region: "Ontario", country: "Canada", latitude: 1, longitude: 2 },
    tags: [],
    photos: [],
    details: {},
    availabilityStatus: "available",
    availabilityBlocks: [],
    effectiveMaxBookingDurationDays: 10,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  } as PostingRecord;
}

describe("postings dashboard helpers", () => {
  it("maps every lifecycle status", () => {
    expect(lifecycleActions("draft").map((action) => action.id)).toEqual(["publish", "archive"]);
    expect(lifecycleActions("published").map((action) => action.id)).toEqual(["pause", "archive"]);
    expect(lifecycleActions("paused").map((action) => action.id)).toEqual(["unpause", "archive"]);
    expect(lifecycleActions("archived")).toEqual([]);
  });

  it("formats variants, valid dates, invalid dates, and price fallbacks", () => {
    expect(formatVariant(posting())).toBe("place / private room");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate("2026-05-01T00:00:00.000Z")).not.toBe("—");
    expect(safePrice(posting())).toContain("/ day");
    expect(
      safePrice(
        posting({ pricing: { currency: "INVALID", daily: { amount: 42 } } }),
      ),
    ).toBe("42 INVALID / day");
  });

  it("chooses positioned, first, thumbnail, blob, and invalid photo URLs", () => {
    expect(primaryPhotoUrl(posting())).toBeNull();
    expect(
      primaryPhotoUrl(
        posting({
          photos: [
            { blobUrl: "https://img/first.jpg", blobName: "first", position: 2 },
            {
              blobUrl: "https://img/primary.jpg",
              thumbnailBlobUrl: "https://img/thumb.jpg",
              blobName: "primary",
              position: 0,
            },
          ],
        }),
      ),
    ).toBe("https://img/thumb.jpg");
    expect(
      primaryPhotoUrl(
        posting({
          photos: [
            { blobUrl: "https://img/first.jpg", blobName: "first", position: 3 },
          ],
        }),
      ),
    ).toBe("https://img/first.jpg");
    expect(
      primaryPhotoUrl(
        posting({
          photos: [
            { blobUrl: "https://example.com/bad.jpg", blobName: "bad", position: 0 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("renders image and family-initial thumbnail states", () => {
    const { rerender } = render(<PostingThumb posting={posting()} />);
    expect(screen.getByText("p")).toBeInTheDocument();
    rerender(
      <PostingThumb
        posting={posting({
          photos: [
            {
              blobUrl: "https://img/studio.jpg",
              blobName: "studio",
              position: 0,
            },
          ],
        })}
      />,
    );
    expect(screen.getByAltText("Studio")).toHaveAttribute(
      "src",
      "https://img/studio.jpg",
    );
  });
});
