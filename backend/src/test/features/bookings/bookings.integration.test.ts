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
const MUTABLE_POSTING_ID = "00000000-0000-0000-2000-000000000003";
const APPROVAL_POSTING_ID = "00000000-0000-0000-2000-000000000001";

describe("Bookings persistence integration", () => {
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

  async function createBookingRequest(input: {
    renterHeaders: HeadersInit;
    postingId: string;
    startAt: string;
    endAt: string;
    guestCount: number;
    note: string;
    contactName: string;
    contactEmail: string;
  }) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${input.postingId}/booking-requests`)}`,
      {
        method: "POST",
        headers: input.renterHeaders,
        body: JSON.stringify({
          startAt: input.startAt,
          endAt: input.endAt,
          guestCount: input.guestCount,
          note: input.note,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
        }),
      },
    );
  }

  it("persists booking creation, renter updates, and cancellation", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });

    const createResponse = await createBookingRequest({
      renterHeaders: renter.headers(),
      postingId: MUTABLE_POSTING_ID,
      startAt: "2027-01-10T16:00:00.000Z",
      endAt: "2027-01-12T16:00:00.000Z",
      guestCount: 1,
      note: "Quiet work trip.",
      contactName: "Viewer One",
      contactEmail: "viewer1@rentify.local",
    });

    expect(createResponse.status).toBe(201);

    const createdBooking =
      await persistenceApp.prisma.bookingRequest.findFirstOrThrow({
        where: {
          postingId: MUTABLE_POSTING_ID,
          renterId: renter.userId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(createdBooking).toMatchObject({
      postingId: MUTABLE_POSTING_ID,
      renterId: renter.userId,
      status: "pending",
      note: "Quiet work trip.",
      contactEmail: "viewer1@rentify.local",
      guestCount: 1,
    });
    expect(createdBooking.holdExpiresAt).toBeTruthy();

    const bookingCreatedEvent =
      await waitForRabbitMqPayload<RecommendationActivityEventPayload>(
        persistenceApp.infra.rabbitMq,
        RECOMMENDATION_ACTIVITY_QUEUE_NAME,
        (payload) =>
          payload.eventType === "booking_request_created" &&
          payload.postingId === MUTABLE_POSTING_ID &&
          payload.actorUserId === renter.userId &&
          payload.metadata?.bookingRequestId === createdBooking.id,
      );
    expect(bookingCreatedEvent).toMatchObject({
      eventType: "booking_request_created",
      postingId: MUTABLE_POSTING_ID,
      actorUserId: renter.userId,
      source: "booking_flow",
      metadata: expect.objectContaining({
        bookingRequestId: createdBooking.id,
        guestCount: 1,
        status: "pending",
      }),
    });

    const updateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${createdBooking.id}`)}`,
      {
        method: "PUT",
        headers: renter.headers(),
        body: JSON.stringify({
          startAt: "2027-01-11T16:00:00.000Z",
          endAt: "2027-01-13T16:00:00.000Z",
          guestCount: 2,
          note: "Updated note",
          contactName: "Viewer One",
          contactEmail: "viewer1@rentify.local",
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.bookingRequest.findUniqueOrThrow({
        where: {
          id: createdBooking.id,
        },
      }),
    ).toMatchObject({
      guestCount: 2,
      note: "Updated note",
      contactEmail: "viewer1@rentify.local",
      startAt: new Date("2027-01-11T16:00:00.000Z"),
      endAt: new Date("2027-01-13T16:00:00.000Z"),
    });

    const cancelResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${createdBooking.id}/cancel`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          reason: "Plans changed.",
        }),
      },
    );

    expect(cancelResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.bookingRequest.findUniqueOrThrow({
        where: {
          id: createdBooking.id,
        },
      }),
    ).toMatchObject({
      status: "cancelled",
      cancellationReason: "Plans changed.",
      cancellationActor: "renter",
    });
  });

  it("persists owner approval and decline decisions", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const approveCreateResponse = await createBookingRequest({
      renterHeaders: renter.headers(),
      postingId: APPROVAL_POSTING_ID,
      startAt: "2027-02-01T16:00:00.000Z",
      endAt: "2027-02-03T16:00:00.000Z",
      guestCount: 2,
      note: "Please approve this stay.",
      contactName: "Viewer One",
      contactEmail: "viewer1@rentify.local",
    });
    const declineCreateResponse = await createBookingRequest({
      renterHeaders: renter.headers(),
      postingId: MUTABLE_POSTING_ID,
      startAt: "2027-02-10T16:00:00.000Z",
      endAt: "2027-02-12T16:00:00.000Z",
      guestCount: 1,
      note: "May need to reschedule.",
      contactName: "Viewer One",
      contactEmail: "viewer1@rentify.local",
    });

    expect(approveCreateResponse.status).toBe(201);
    expect(declineCreateResponse.status).toBe(201);

    const [bookingToApprove, bookingToDecline] = await Promise.all([
      persistenceApp.prisma.bookingRequest.findFirstOrThrow({
        where: {
          postingId: APPROVAL_POSTING_ID,
          renterId: renter.userId,
          startAt: new Date("2027-02-01T16:00:00.000Z"),
        },
      }),
      persistenceApp.prisma.bookingRequest.findFirstOrThrow({
        where: {
          postingId: MUTABLE_POSTING_ID,
          renterId: renter.userId,
          startAt: new Date("2027-02-10T16:00:00.000Z"),
        },
      }),
    ]);

    const approveResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingToApprove.id}/approve`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          note: "Approved for the requested dates.",
        }),
      },
    );
    const declineResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${bookingToDecline.id}/decline`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          note: "No longer available.",
        }),
      },
    );

    expect(approveResponse.status).toBe(200);
    expect(declineResponse.status).toBe(200);

    expect(
      await persistenceApp.prisma.bookingRequest.findUniqueOrThrow({
        where: {
          id: bookingToApprove.id,
        },
      }),
    ).toMatchObject({
      status: "awaiting_payment",
      decisionNote: "Approved for the requested dates.",
      holdBlockId: null,
    });
    expect(
      await persistenceApp.prisma.bookingRequest.findUniqueOrThrow({
        where: {
          id: bookingToDecline.id,
        },
      }),
    ).toMatchObject({
      status: "declined",
      decisionNote: "No longer available.",
    });
  });

  it("does not persist invalid booking create requests", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });
    const beforeCount = await persistenceApp.prisma.bookingRequest.count();

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${MUTABLE_POSTING_ID}/booking-requests`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          startAt: "not-a-date",
          endAt: "2027-01-12T16:00:00.000Z",
          guestCount: 0,
          contactName: "",
          contactEmail: "not-an-email",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await persistenceApp.prisma.bookingRequest.count()).toBe(
      beforeCount,
    );
  });
});
