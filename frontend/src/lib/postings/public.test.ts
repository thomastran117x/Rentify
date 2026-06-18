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

  it("preserves network failure details in the domain error debug payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(fetchPublicPostingDetail("posting-9")).rejects.toMatchObject<
      Partial<PublicPostingDetailError>
    >({
      message: "Unable to reach the server.",
      debug: {
        requestUrl: "/postings/posting-9",
        causeMessage: "fetch failed",
      },
    });
  });

  it("loads posting detail safely during server rendering", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              id: "posting-3",
              organizationId: "org-1",
              status: "published",
              variant: {
                family: "place",
                subtype: "entire_place",
              },
              name: "Beltline Designer Flat",
              description: "A bright designer flat in Calgary's Beltline.",
              pricing: {
                currency: "CAD",
                daily: {
                  amount: 210,
                },
              },
              pricingCurrency: "CAD",
              photos: [],
              tags: ["beltline", "design"],
              details: {},
              availabilityStatus: "available",
              effectiveMaxBookingDurationDays: 14,
              availabilityBlocks: [],
              location: {
                city: "Calgary",
                region: "Alberta",
                country: "Canada",
                latitude: 51.0447,
                longitude: -114.0719,
              },
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-01T00:00:00.000Z",
            },
            error: null,
            meta: {
              requestId: "request-4",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });

    try {
      const posting = await fetchPublicPostingDetail("posting-3");

      expect(posting.name).toBe("Beltline Designer Flat");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8040/api/v1/postings/posting-3",
        expect.objectContaining({
          headers: {
            accept: "application/json",
          },
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });
});
