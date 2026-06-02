import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicPostingDetailError, fetchPublicPostingDetail } from "./public";
import {
  formatPostingAttributeLabel,
  formatPostingAttributeValue,
} from "./public-format";

describe("fetchPublicPostingDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a public posting and supports formatting helpers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              message: "ok",
              data: {
                id: "posting-1",
                organizationId: "org-1",
                organization: {
                  id: "org-1",
                  name: "Studio Loft Collective",
                },
                status: "published",
                variant: {
                  family: "place",
                  subtype: "workspace",
                },
                name: "Studio Loft",
                description: "Bright workspace in the city core.",
                pricing: {
                  currency: "CAD",
                  daily: {
                    amount: 145,
                  },
                },
                pricingCurrency: "CAD",
                photos: [],
                tags: ["wifi"],
                details: {
                  guest_capacity: 12,
                  parking: true,
                  amenities: ["wifi", "projector"],
                },
                availabilityStatus: "available",
                effectiveMaxBookingDurationDays: 7,
                availabilityBlocks: [],
                location: {
                  city: "Toronto",
                  region: "Ontario",
                  country: "Canada",
                  latitude: 43.65,
                  longitude: -79.38,
                },
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
              },
              error: null,
              meta: {
                requestId: "request-1",
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    const posting = await fetchPublicPostingDetail("posting-1");

    expect(posting.name).toBe("Studio Loft");
    expect(posting.variant.subtype).toBe("workspace");
    expect(formatPostingAttributeLabel("guest_capacity")).toBe(
      "Guest capacity",
    );
    expect(formatPostingAttributeValue(posting.details.amenities)).toBe(
      "Wi-Fi, Projector",
    );
  });

  it("throws a typed not-found error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              message: "Posting could not be found.",
              data: null,
              error: {
                code: "NOT_FOUND",
              },
              meta: {
                requestId: "request-2",
              },
            }),
            {
              status: 404,
              statusText: "Not Found",
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    await expect(
      fetchPublicPostingDetail("missing-posting"),
    ).rejects.toMatchObject<Partial<PublicPostingDetailError>>({
      message: "Posting could not be found.",
      debug: {
        status: 404,
      },
    });
  });

  it("throws a typed server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              message: "Server exploded.",
              data: null,
              error: {
                code: "INTERNAL_SERVER_ERROR",
              },
              meta: {
                requestId: "request-3",
              },
            }),
            {
              status: 500,
              statusText: "Internal Server Error",
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    await expect(fetchPublicPostingDetail("posting-2")).rejects.toMatchObject<
      Partial<PublicPostingDetailError>
    >({
      message: "Server exploded.",
      debug: {
        status: 500,
      },
    });
  });
});
