import { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { testUuid } from "../../support/uuid";
const POSTING_1_ID = testUuid(9000, 254272);

const USER_1_ID = testUuid(9000, 994257);

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
  it("skips posting view publishing for non-public postings and bot clients", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const findRecommendationPersonalizationEnabledByUserId = jest.fn(
      async () => true,
    );
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId,
      } as any,
    );

    await publisher.publishPostingView({
      posting: {
        id: "posting-draft",
        ownerId: "owner-1",
        status: "draft",
      } as any,
      client: createClient(),
    });

    await publisher.publishPostingView({
      posting: {
        id: POSTING_1_ID,
        ownerId: "owner-1",
        status: "published",
      } as any,
      client: createClient({
        device: {
          id: "bot-1",
          type: "bot",
          isMobile: false,
          userAgent: "bot-agent",
          platform: "crawler",
        },
      }),
    });

    expect(publishActivityEvent).not.toHaveBeenCalled();
    expect(
      findRecommendationPersonalizationEnabledByUserId,
    ).not.toHaveBeenCalled();
  });

  it("publishes opted-in posting views with personalization enabled", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as any,
    );

    await publisher.publishPostingView({
      posting: {
        id: POSTING_1_ID,
        ownerId: "owner-1",
        status: "published",
      } as any,
      client: createClient(),
      requestId: "request-1",
      actorUserId: USER_1_ID,
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "posting_view",
        postingId: POSTING_1_ID,
        actorUserId: USER_1_ID,
        personalizationEnabled: true,
        anonymousActorHash: null,
      }),
    );
  });

  it("publishes anonymous posting views with a derived actor hash", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as any,
    );

    await publisher.publishPostingView({
      posting: {
        id: POSTING_1_ID,
        ownerId: "owner-1",
        status: "published",
      } as any,
      client: createClient({
        ip: "203.0.113.10",
        device: {
          id: "device-anon",
          type: "desktop",
          isMobile: false,
          userAgent: "anon-agent",
          platform: "anon-os",
        },
      }),
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        requestId: null,
        personalizationEnabled: null,
        anonymousActorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("publishes opted-out booking activity without personalization eligibility", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => false,
        ),
      } as any,
    );

    await publisher.publishBookingRequestCreated({
      bookingRequest: {
        id: "booking-1",
        postingId: POSTING_1_ID,
        renterId: USER_1_ID,
        createdAt: "2026-04-30T12:00:00.000Z",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        guestCount: 2,
        status: "pending",
      } as any,
      client: createClient(),
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "booking_request_created",
        actorUserId: USER_1_ID,
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
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as any,
    );

    await expect(
      publisher.publishSearchClick({
        postingId: POSTING_1_ID,
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

  it("skips search click publishing for bot clients", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as any,
    );

    await publisher.publishSearchClick({
      postingId: POSTING_1_ID,
      client: createClient({
        device: {
          id: "bot-1",
          type: "bot",
          isMobile: false,
          userAgent: "bot-agent",
          platform: "crawler",
        },
      }),
      body: {
        searchSessionId: "search-1",
        page: 1,
        position: 0,
        hasGeoFilter: false,
        hasAvailabilityFilter: false,
      },
    });

    expect(publishActivityEvent).not.toHaveBeenCalled();
  });

  it("publishes anonymous search clicks with a derived actor hash", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => true,
        ),
      } as any,
    );

    await publisher.publishSearchClick({
      postingId: POSTING_1_ID,
      client: createClient({
        ip: "198.51.100.20",
        device: {
          id: "device-search-anon",
          type: "desktop",
          isMobile: false,
          userAgent: "search-agent",
          platform: "search-os",
        },
      }),
      body: {
        searchSessionId: "search-1",
        page: 2,
        position: 4,
        hasGeoFilter: true,
        hasAvailabilityFilter: true,
      },
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "search_click",
        actorUserId: null,
        anonymousActorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        requestId: null,
      }),
    );
  });

  it("publishes renting confirmations with renter metadata and default personalization", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId: jest.fn(
          async () => undefined,
        ),
      } as any,
    );

    await publisher.publishRentingConfirmed({
      renting: {
        id: "renting-1",
        postingId: POSTING_1_ID,
        bookingRequestId: "booking-1",
        renterId: USER_1_ID,
        confirmedAt: "2026-05-03T10:00:00.000Z",
        startAt: "2026-05-10T12:00:00.000Z",
        endAt: "2026-05-12T12:00:00.000Z",
        guestCount: 3,
      } as any,
      client: createClient(),
      requestId: "request-9",
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "renting_confirmed",
        actorUserId: USER_1_ID,
        requestId: "request-9",
        source: "renting_flow",
        personalizationEnabled: true,
        metadata: {
          rentingId: "renting-1",
          bookingRequestId: "booking-1",
          startAt: "2026-05-10T12:00:00.000Z",
          endAt: "2026-05-12T12:00:00.000Z",
          guestCount: 3,
        },
      }),
    );
  });

  it("publishes posting lifecycle events with nullable actor context", async () => {
    const publishActivityEvent = jest.fn(async () => undefined);
    const findRecommendationPersonalizationEnabledByUserId = jest.fn(
      async () => true,
    );
    const publisher = new RecommendationActivityPublisher(
      {
        publishActivityEvent,
      } as any,
      {
        findRecommendationPersonalizationEnabledByUserId,
      } as any,
    );

    await publisher.publishPostingLifecycle({
      posting: {
        id: POSTING_1_ID,
        ownerId: "owner-1",
        status: "archived",
      } as any,
      eventType: "posting_archived",
      client: createClient(),
    });

    expect(publishActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "posting_archived",
        actorUserId: null,
        anonymousActorHash: null,
        source: "posting_lifecycle",
        personalizationEnabled: null,
        metadata: {
          status: "archived",
        },
      }),
    );
    expect(
      findRecommendationPersonalizationEnabledByUserId,
    ).not.toHaveBeenCalled();
  });
});
