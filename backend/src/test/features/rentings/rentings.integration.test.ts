import { randomUUID } from "node:crypto";
import { buildApiPath } from "@/configuration/http/api-path";
import type { RecommendationActivityEventPayload } from "@/features/recommendations/recommendation-activity.model";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";

const RECOMMENDATION_ACTIVITY_QUEUE_NAME = "recommendation-activity.main";
const OWNER_POSTING_ID = "00000000-0000-0000-2000-000000000001";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

async function loadPostingPricing(persistenceApp: PersistenceTestApp) {
  const posting = await persistenceApp.prisma.posting.findUniqueOrThrow({
    where: {
      id: OWNER_POSTING_ID,
    },
  });
  const pricing = posting.pricing as {
    daily?: {
      amount?: number;
    };
  };

  return {
    posting,
    dailyPriceAmount: Number(pricing.daily?.amount ?? 0),
  };
}

async function createConvertibleBookingFixture(
  persistenceApp: PersistenceTestApp,
) {
  const { posting, dailyPriceAmount } =
    await loadPostingPricing(persistenceApp);
  const renter = await persistenceApp.prisma.user.findUniqueOrThrow({
    where: {
      email: "viewer1@rentify.local",
    },
  });
  const bookingRequestId = randomUUID();

  await persistenceApp.prisma.bookingRequest.create({
    data: {
      id: bookingRequestId,
      postingId: posting.id,
      renterId: renter.id,
      organizationId: posting.organizationId,
      status: "paid",
      startAt: new Date("2027-03-10T16:00:00.000Z"),
      endAt: new Date("2027-03-12T16:00:00.000Z"),
      durationDays: 2,
      guestCount: 2,
      contactName: "Viewer One",
      contactEmail: renter.email,
      note: "Convertible paid booking.",
      pricingCurrency: posting.pricingCurrency,
      pricingSnapshot: posting.pricing as any,
      dailyPriceAmount,
      estimatedTotal: dailyPriceAmount * 2,
      approvedAt: new Date("2027-03-01T16:00:00.000Z"),
      paymentRequiredAt: new Date("2027-03-02T16:00:00.000Z"),
      holdExpiresAt: new Date("2027-03-03T16:00:00.000Z"),
    },
  });

  return {
    bookingRequestId,
  };
}

async function createRentingFixture(
  persistenceApp: PersistenceTestApp,
  options: {
    status: "confirmed" | "completed";
  },
) {
  const { posting, dailyPriceAmount } =
    await loadPostingPricing(persistenceApp);
  const renter = await persistenceApp.prisma.user.findUniqueOrThrow({
    where: {
      email: "viewer1@rentify.local",
    },
  });
  const bookingRequestId = randomUUID();
  const rentingId = randomUUID();
  const completedAt = new Date(Date.now() - 2 * MILLISECONDS_PER_DAY);

  await persistenceApp.prisma.bookingRequest.create({
    data: {
      id: bookingRequestId,
      postingId: posting.id,
      renterId: renter.id,
      organizationId: posting.organizationId,
      status: "paid",
      startAt: new Date("2027-04-10T16:00:00.000Z"),
      endAt: new Date("2027-04-12T16:00:00.000Z"),
      durationDays: 2,
      guestCount: 2,
      contactName: "Viewer One",
      contactEmail: renter.email,
      note: "Renting lifecycle fixture.",
      pricingCurrency: posting.pricingCurrency,
      pricingSnapshot: posting.pricing as any,
      dailyPriceAmount,
      estimatedTotal: dailyPriceAmount * 2,
      approvedAt: new Date("2027-04-01T16:00:00.000Z"),
      paymentRequiredAt: new Date("2027-04-02T16:00:00.000Z"),
      holdExpiresAt: new Date("2027-04-03T16:00:00.000Z"),
      convertedAt: new Date("2027-04-05T16:00:00.000Z"),
    },
  });

  await persistenceApp.prisma.renting.create({
    data: {
      id: rentingId,
      postingId: posting.id,
      bookingRequestId,
      renterId: renter.id,
      organizationId: posting.organizationId,
      status: options.status,
      startAt: new Date("2027-04-10T16:00:00.000Z"),
      endAt: new Date("2027-04-12T16:00:00.000Z"),
      durationDays: 2,
      guestCount: 2,
      pricingCurrency: posting.pricingCurrency,
      pricingSnapshot: posting.pricing as any,
      dailyPriceAmount,
      estimatedTotal: dailyPriceAmount * 2,
      confirmedAt: new Date("2027-04-05T16:00:00.000Z"),
      pickupInstructions:
        options.status === "completed" ? "Meet at the front desk." : null,
      returnInstructions:
        options.status === "completed"
          ? "Leave keys with the concierge."
          : null,
      checkInReadyAt:
        options.status === "completed"
          ? new Date(completedAt.getTime() - 2 * 60 * 60 * 1000)
          : null,
      checkInCompletedAt:
        options.status === "completed"
          ? new Date(completedAt.getTime() - 90 * 60 * 1000)
          : null,
      returnDueAt:
        options.status === "completed"
          ? new Date(completedAt.getTime() - 30 * 60 * 1000)
          : null,
      completedAt: options.status === "completed" ? completedAt : null,
    },
  });

  return {
    rentingId,
    renterEmail: renter.email,
  };
}

describe("Rentings persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("persists booking conversion into a renting", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const fixture = await createConvertibleBookingFixture(persistenceApp);

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${fixture.bookingRequestId}/convert`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );

    expect(response.status).toBe(201);

    const booking =
      await persistenceApp.prisma.bookingRequest.findUniqueOrThrow({
        where: {
          id: fixture.bookingRequestId,
        },
      });
    const renting = await persistenceApp.prisma.renting.findUnique({
      where: {
        bookingRequestId: fixture.bookingRequestId,
      },
    });

    expect(booking.convertedAt).not.toBeNull();
    expect(booking.conversionReservedAt).toBeNull();
    expect(booking.conversionReservationExpiresAt).toBeNull();
    expect(renting).toMatchObject({
      bookingRequestId: fixture.bookingRequestId,
      status: "confirmed",
    });

    const rentingConfirmedEvent =
      await waitForRabbitMqPayload<RecommendationActivityEventPayload>(
        persistenceApp.infra.rabbitMq,
        RECOMMENDATION_ACTIVITY_QUEUE_NAME,
        (payload) =>
          payload.eventType === "renting_confirmed" &&
          payload.postingId === OWNER_POSTING_ID &&
          payload.metadata?.rentingId === renting?.id &&
          payload.metadata?.bookingRequestId === fixture.bookingRequestId,
      );
    expect(rentingConfirmedEvent).toMatchObject({
      eventType: "renting_confirmed",
      postingId: OWNER_POSTING_ID,
      actorUserId: renting?.renterId,
      source: "renting_flow",
      metadata: expect.objectContaining({
        rentingId: renting?.id,
        bookingRequestId: fixture.bookingRequestId,
        guestCount: 2,
      }),
    });
  });

  it("persists renting lifecycle transitions and disputes", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const fixture = await createRentingFixture(persistenceApp, {
      status: "confirmed",
    });
    const renter = await createAuthenticatedRequestContext({
      email: fixture.renterEmail,
    });

    const updateInstructionsResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/rentings/${fixture.rentingId}/instructions`)}`,
      {
        method: "PUT",
        headers: owner.headers(),
        body: JSON.stringify({
          pickupInstructions: "Meet at the lobby desk.",
          returnInstructions: "Leave the keys in the lockbox.",
        }),
      },
    );
    const checkInReadyResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/rentings/${fixture.rentingId}/check-in-ready`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );
    const checkInResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/rentings/${fixture.rentingId}/check-in`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );
    const returnResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/rentings/${fixture.rentingId}/return`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );
    const disputeResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/rentings/${fixture.rentingId}/disputes`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          reason: "Missing equipment",
          details: "One monitor was missing at pickup.",
        }),
      },
    );

    expect(updateInstructionsResponse.status).toBe(200);
    expect(checkInReadyResponse.status).toBe(200);
    expect(checkInResponse.status).toBe(200);
    expect(returnResponse.status).toBe(200);
    expect(disputeResponse.status).toBe(201);

    expect(
      await persistenceApp.prisma.renting.findUniqueOrThrow({
        where: {
          id: fixture.rentingId,
        },
      }),
    ).toMatchObject({
      status: "disputed",
      pickupInstructions: "Meet at the lobby desk.",
      returnInstructions: "Leave the keys in the lockbox.",
      completedAt: expect.any(Date),
      disputedAt: expect.any(Date),
    });
    expect(
      await persistenceApp.prisma.rentingDispute.findFirst({
        where: {
          rentingId: fixture.rentingId,
          openedByUserId: renter.userId,
        },
      }),
    ).toMatchObject({
      reason: "Missing equipment",
      details: "One monitor was missing at pickup.",
    });
  });

  it("does not mutate a renting on invalid dispute submissions", async () => {
    const fixture = await createRentingFixture(persistenceApp, {
      status: "completed",
    });
    const renter = await createAuthenticatedRequestContext({
      email: fixture.renterEmail,
    });
    const beforeCount = await persistenceApp.prisma.rentingDispute.count({
      where: {
        rentingId: fixture.rentingId,
      },
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/rentings/${fixture.rentingId}/disputes`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          reason: "",
          details: "",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(
      await persistenceApp.prisma.rentingDispute.count({
        where: {
          rentingId: fixture.rentingId,
        },
      }),
    ).toBe(beforeCount);
  });
});
