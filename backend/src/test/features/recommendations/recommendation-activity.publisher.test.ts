import { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import type { ClientRequestContext } from "@/configuration/http/bindings";

function createClient(
  overrides: Partial<ClientRequestContext> = {},
): ClientRequestContext {
  return {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "test-agent",
      platform: "test-os",
    },
    ...overrides,
  };
}

describe("RecommendationActivityPublisher", () => {
  it("publishes opted-in posting views with personalization enabled", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as never,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as never,
    );

    await publisher.publishPostingView({
      posting: {
        id: "posting-1",
        ownerId: "owner-1",
        status: "published",
      } as never,
      client: createClient(),
      requestId: "request-1",
      actorUserId: "user-1",
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "posting_view",
        postingId: "posting-1",
        actorUserId: "user-1",
        personalizationEnabled: true,
        anonymousActorHash: null,
      }),
    );
  });

  it("publishes opted-out booking activity without personalization eligibility", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as never,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => false,
        ),
      } as never,
    );

    await publisher.publishBookingRequestCreated({
      bookingRequest: {
        id: "booking-1",
        postingId: "posting-1",
        renterId: "user-1",
        createdAt: "2026-04-30T12:00:00.000Z",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        guestCount: 2,
        status: "pending",
      } as never,
      client: createClient(),
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "booking_request_created",
        actorUserId: "user-1",
        personalizationEnabled: false,
      }),
    );
  });

  it("swallows broker publish failures on search click tracking", async () => {
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent: jest.fn(async () => {
          throw new Error("broker-down");
        }),
      } as never,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as never,
    );

    await expect(
      publisher.publishSearchClick({
        postingId: "posting-1",
        client: createClient(),
        body: {
          searchSessionId: "search-1",
          page: 1,
          position: 0,
          hasGeoFilter: false,
          hasAvailabilityFilter: false,
        },
      }),
    ).resolves.toBeUndefined();
  });
});
