import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { BookingsController } from "@/features/bookings/bookings.controller";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

function createPagination() {
  return {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

function createBookingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "user-1",
    ownerUserId: "owner-1",
    status: "pending",
    startAt: "2026-06-20T00:00:00.000Z",
    endAt: "2026-06-22T00:00:00.000Z",
    guestCount: 2,
    contactName: "Taylor Renter",
    contactEmail: "taylor@example.com",
    contactPhoneNumber: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createApp() {
  const bookingsService = {
    create: jest.fn(async (input: { renterId: string }) =>
      createBookingRequest({
        renterId: input.renterId,
      }),
    ),
    quote: jest.fn(async () => ({
      currency: "CAD",
      subtotal: 300,
      fees: 30,
      total: 330,
    })),
    listForOwnerPosting: jest.fn(async () => ({
      bookingRequests: [createBookingRequest()],
      pagination: createPagination(),
    })),
    listMine: jest.fn(async () => ({
      bookingRequests: [createBookingRequest()],
      pagination: createPagination(),
    })),
    listOwned: jest.fn(async () => ({
      bookingRequests: [createBookingRequest()],
      pagination: createPagination(),
    })),
    dashboardMine: jest.fn(async () => ({
      bookingRequests: [createBookingRequest()],
      pagination: createPagination(),
      buckets: {
        upcoming: 1,
      },
    })),
    dashboardOwned: jest.fn(async () => ({
      bookingRequests: [createBookingRequest()],
      pagination: createPagination(),
      buckets: {
        pending: 1,
      },
    })),
    getById: jest.fn(async () => createBookingRequest()),
    getCancellationQuote: jest.fn(async () => ({
      refundableAmount: 250,
      cancellationFee: 50,
      currency: "CAD",
    })),
    updateOwnPending: jest.fn(async () =>
      createBookingRequest({
        note: "Updated note",
      }),
    ),
    approve: jest.fn(async () =>
      createBookingRequest({
        status: "approved",
      }),
    ),
    decline: jest.fn(async () =>
      createBookingRequest({
        status: "declined",
      }),
    ),
    cancel: jest.fn(async () =>
      createBookingRequest({
        status: "cancelled",
      }),
    ),
  };

  const recommendationActivityPublisher = {
    publishBookingRequestCreated: jest.fn(async () => undefined),
  };

  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "owner-token") {
        return createJwtClaims({
          sub: "owner-1",
          email: "owner@example.com",
          role: "owner",
        });
      }

      if (token === "user-token") {
        return createJwtClaims();
      }

      throw new UnauthorizedError("Invalid access token signature.");
    }),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.bookingsController,
      new BookingsController(
        bookingsService as never,
        recommendationActivityPublisher as never,
      ),
    ],
    [containerTokens.tokenService, tokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    bookingsService,
    recommendationActivityPublisher,
  };
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("Bookings integration", () => {
  it("covers booking request creation, quote, and list endpoints", async () => {
    const { app, bookingsService, recommendationActivityPublisher } =
      createApp();

    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-requests")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-20T00:00:00.000Z",
          endAt: "2026-06-22T00:00:00.000Z",
          guestCount: 2,
          note: "Need parking access.",
          contactName: "Taylor Renter",
          contactEmail: "taylor@example.com",
        }),
      },
    );
    const quoteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-quote")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-20T00:00:00.000Z",
          endAt: "2026-06-22T00:00:00.000Z",
          guestCount: 2,
          note: "Need parking access.",
        }),
      },
    );
    const listForPostingResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-requests?page=1&pageSize=20&status=pending")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );
    const listMineResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me?page=1&pageSize=20&status=pending")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const listOwnedResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/owner?page=1&pageSize=20&status=pending")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );
    const dashboardMineResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me/dashboard?page=1&pageSize=20&sort=urgency&bucket=upcoming&status=pending")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const dashboardOwnedResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/owner/dashboard?page=1&pageSize=20&sort=urgency&status=pending&actionNeeded=approval&postingId=posting-1")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );

    expect(createResponse.status).toBe(201);
    expect(quoteResponse.status).toBe(200);
    expect(listForPostingResponse.status).toBe(200);
    expect(listMineResponse.status).toBe(200);
    expect(listOwnedResponse.status).toBe(200);
    expect(dashboardMineResponse.status).toBe(200);
    expect(dashboardOwnedResponse.status).toBe(200);

    expect(bookingsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        postingId: "posting-1",
        renterId: "user-1",
        guestCount: 2,
      }),
    );
    expect(
      recommendationActivityPublisher.publishBookingRequestCreated,
    ).toHaveBeenCalledTimes(1);
    expect(bookingsService.quote).toHaveBeenCalledWith(
      expect.objectContaining({
        postingId: "posting-1",
        renterId: "user-1",
      }),
    );
    expect(bookingsService.listForOwnerPosting).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      postingId: "posting-1",
      page: 1,
      pageSize: 20,
      status: "pending",
    });
    expect(bookingsService.listMine).toHaveBeenCalledWith({
      renterId: "user-1",
      page: 1,
      pageSize: 20,
      status: "pending",
    });
    expect(bookingsService.listOwned).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      status: "pending",
    });
    expect(bookingsService.dashboardMine).toHaveBeenCalledWith({
      renterId: "user-1",
      page: 1,
      pageSize: 20,
      sort: "urgency",
      bucket: "upcoming",
      status: "pending",
    });
    expect(bookingsService.dashboardOwned).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      sort: "urgency",
      status: "pending",
      actionNeeded: "approval",
      postingId: "posting-1",
    });
  });

  it("covers booking request detail and mutation endpoints", async () => {
    const { app, bookingsService } = createApp();

    const getResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const cancellationQuoteResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/cancellation-quote")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const updateResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1")}`,
      {
        method: "PUT",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-21T00:00:00.000Z",
          endAt: "2026-06-23T00:00:00.000Z",
          guestCount: 3,
          note: "Updated note",
          contactName: "Taylor Renter",
          contactEmail: "taylor@example.com",
        }),
      },
    );
    const approveResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/approve")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
        body: JSON.stringify({
          note: "Approved for requested dates.",
        }),
      },
    );
    const declineResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/decline")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
        body: JSON.stringify({
          note: "No longer available.",
        }),
      },
    );
    const cancelResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/cancel")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          reason: "Plans changed.",
        }),
      },
    );

    expect(getResponse.status).toBe(200);
    expect(cancellationQuoteResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(approveResponse.status).toBe(200);
    expect(declineResponse.status).toBe(200);
    expect(cancelResponse.status).toBe(200);

    expect(bookingsService.getById).toHaveBeenCalledWith("booking-1", "user-1");
    expect(bookingsService.getCancellationQuote).toHaveBeenCalledWith(
      "booking-1",
      "user-1",
    );
    expect(bookingsService.updateOwnPending).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRequestId: "booking-1",
        renterId: "user-1",
        guestCount: 3,
      }),
    );
    expect(bookingsService.approve).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
      note: "Approved for requested dates.",
    });
    expect(bookingsService.decline).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
      note: "No longer available.",
    });
    expect(bookingsService.cancel).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "user-1",
      reason: "Plans changed.",
    });
  });

  it("returns structured authorization and validation failures across bookings endpoints", async () => {
    const { app, bookingsService, recommendationActivityPublisher } =
      createApp();

    const missingAuthResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me")}`,
    );
    const invalidTokenResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1")}`,
      {
        headers: authHeaders("broken-token"),
      },
    );
    const invalidCreateResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-requests")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "not-a-date",
          endAt: "2026-06-22T00:00:00.000Z",
          guestCount: 0,
          contactName: "",
          contactEmail: "not-an-email",
        }),
      },
    );
    const invalidQuoteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-quote")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-20T00:00:00.000Z",
          endAt: "2026-06-22T00:00:00.000Z",
          guestCount: 21,
        }),
      },
    );
    const invalidListQueryResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me?page=0&pageSize=999&status=unknown")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const invalidRenterDashboardQueryResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me/dashboard?sort=oldest&bucket=soon")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const invalidOwnerDashboardQueryResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/owner/dashboard?actionNeeded=review&postingId=")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );
    const invalidUpdateResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1")}`,
      {
        method: "PUT",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-21T00:00:00.000Z",
          endAt: "2026-06-23T00:00:00.000Z",
          guestCount: "abc",
          contactName: "Taylor Renter",
          contactEmail: "taylor@example.com",
        }),
      },
    );
    const invalidApproveResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/approve")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
        body: JSON.stringify({
          note: "x".repeat(1001),
        }),
      },
    );
    const invalidCancelResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/cancel")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          reason: "",
        }),
      },
    );

    expect(missingAuthResponse.status).toBe(401);
    await expect(missingAuthResponse.json()).resolves.toEqual({
      success: false,
      message: "Authorization header is required.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidTokenResponse.status).toBe(401);
    await expect(invalidTokenResponse.json()).resolves.toEqual({
      success: false,
      message: "Invalid access token signature.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    for (const response of [
      invalidCreateResponse,
      invalidQuoteResponse,
      invalidListQueryResponse,
      invalidRenterDashboardQueryResponse,
      invalidOwnerDashboardQueryResponse,
      invalidUpdateResponse,
      invalidApproveResponse,
      invalidCancelResponse,
    ]) {
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
        },
      });
    }

    expect(bookingsService.create).not.toHaveBeenCalled();
    expect(bookingsService.quote).not.toHaveBeenCalled();
    expect(bookingsService.listMine).not.toHaveBeenCalled();
    expect(bookingsService.dashboardMine).not.toHaveBeenCalled();
    expect(bookingsService.dashboardOwned).not.toHaveBeenCalled();
    expect(bookingsService.updateOwnPending).not.toHaveBeenCalled();
    expect(bookingsService.approve).not.toHaveBeenCalled();
    expect(bookingsService.cancel).not.toHaveBeenCalled();
    expect(
      recommendationActivityPublisher.publishBookingRequestCreated,
    ).not.toHaveBeenCalled();
  });

  it("applies booking query defaults and accepts optional fields when omitted or nullable", async () => {
    const { app, bookingsService, recommendationActivityPublisher } =
      createApp();

    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-requests")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-20T00:00:00.000Z",
          endAt: "2026-06-22T00:00:00.000Z",
          contactName: "Taylor Renter",
          contactEmail: "TAYLOR@example.com",
          contactPhoneNumber: null,
          note: null,
        }),
      },
    );
    const quoteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-quote")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          startAt: "2026-06-20T00:00:00.000Z",
          endAt: "2026-06-22T00:00:00.000Z",
        }),
      },
    );
    const listMineResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const listOwnedResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/owner")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );
    const dashboardMineResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/me/dashboard")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const dashboardOwnedResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/owner/dashboard")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );
    const listForPostingResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/booking-requests")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );
    const declineResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/decline")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
        body: JSON.stringify({
          note: null,
        }),
      },
    );
    const cancelResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/cancel")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          reason: null,
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    expect(quoteResponse.status).toBe(200);
    expect(listMineResponse.status).toBe(200);
    expect(listOwnedResponse.status).toBe(200);
    expect(dashboardMineResponse.status).toBe(200);
    expect(dashboardOwnedResponse.status).toBe(200);
    expect(listForPostingResponse.status).toBe(200);
    expect(declineResponse.status).toBe(200);
    expect(cancelResponse.status).toBe(200);

    expect(bookingsService.create).toHaveBeenCalledWith({
      postingId: "posting-1",
      renterId: "user-1",
      startAt: "2026-06-20T00:00:00.000Z",
      endAt: "2026-06-22T00:00:00.000Z",
      guestCount: undefined,
      note: null,
      contactName: "Taylor Renter",
      contactEmail: "taylor@example.com",
      contactPhoneNumber: null,
    });
    expect(
      recommendationActivityPublisher.publishBookingRequestCreated,
    ).toHaveBeenCalledTimes(1);
    expect(bookingsService.quote).toHaveBeenCalledWith({
      postingId: "posting-1",
      renterId: "user-1",
      startAt: "2026-06-20T00:00:00.000Z",
      endAt: "2026-06-22T00:00:00.000Z",
      guestCount: undefined,
      note: null,
    });
    expect(bookingsService.listMine).toHaveBeenCalledWith({
      renterId: "user-1",
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(bookingsService.listOwned).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(bookingsService.dashboardMine).toHaveBeenCalledWith({
      renterId: "user-1",
      page: 1,
      pageSize: 20,
      sort: "urgency",
      bucket: undefined,
      status: undefined,
    });
    expect(bookingsService.dashboardOwned).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      sort: "urgency",
      status: undefined,
      actionNeeded: undefined,
      postingId: undefined,
    });
    expect(bookingsService.listForOwnerPosting).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      postingId: "posting-1",
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(bookingsService.decline).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
      note: null,
    });
    expect(bookingsService.cancel).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "user-1",
      reason: null,
    });
  });
});
