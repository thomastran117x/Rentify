import assert from "node:assert/strict";

const { PublicPostingDetailError, fetchPublicPostingDetail } = await import(
  new URL("./public.ts", import.meta.url).href
);
const { formatPostingAttributeLabel, formatPostingAttributeValue } =
  await import(new URL("./public-format.ts", import.meta.url).href);

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        message: "ok",
        data: {
          id: "posting-1",
          ownerId: "owner-1",
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
    );

  const posting = await fetchPublicPostingDetail("posting-1");

  assert.equal(posting.name, "Studio Loft");
  assert.equal(posting.variant.subtype, "workspace");
  assert.equal(formatPostingAttributeLabel("guest_capacity"), "Guest capacity");
  assert.equal(
    formatPostingAttributeValue(posting.details.amenities),
    "Wi-Fi, Projector",
  );

  globalThis.fetch = async () =>
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
    );

  await assert.rejects(
    () => fetchPublicPostingDetail("missing-posting"),
    (error: unknown) => {
      if (!(error instanceof PublicPostingDetailError)) {
        return false;
      }

      const detailError = error as InstanceType<
        typeof PublicPostingDetailError
      >;
      return (
        detailError.debug.status === 404 &&
        detailError.message === "Posting could not be found."
      );
    },
  );

  globalThis.fetch = async () =>
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
    );

  await assert.rejects(
    () => fetchPublicPostingDetail("posting-2"),
    (error: unknown) => {
      if (!(error instanceof PublicPostingDetailError)) {
        return false;
      }

      const detailError = error as InstanceType<
        typeof PublicPostingDetailError
      >;
      return (
        detailError.debug.status === 500 &&
        detailError.message === "Server exploded."
      );
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}
