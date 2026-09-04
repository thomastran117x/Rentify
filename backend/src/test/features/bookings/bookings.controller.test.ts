import { createTestContext, invoke } from "../../support/mock-http";
import { BookingsController } from "@/features/bookings/bookings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { testUuid } from "../../support/uuid";
const USER_3_ID = testUuid(9000, 994259);

const BOOKING_ONE_ID = testUuid(1020, 1);
const BOOKING_TWO_ID = testUuid(1020, 2);
const POSTING_ID = testUuid(2000, 1);
const POSTING_TWO_ID = testUuid(2000, 2);
const RENTER_ONE_ID = testUuid(1000, 1);
const RENTER_TWO_ID = testUuid(1000, 2);
const OWNER_ONE_ID = testUuid(1000, 3);
const OWNER_TWO_ID = testUuid(1000, 4);
const USER_ID = testUuid(1000, 5);

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: USER_ID,
    email: `${USER_ID}@example.com`,
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options?: {
  body?: unknown;
  url?: string;
  params?: Record<string, string>;
}) {
  return createTestContext({
    body: options?.body,
    params: options?.params,
    url: options?.url ?? "https://example.test/booking-requests/me",
    state: {
      requestId: "request-1",
      client: {
        ip: "127.0.0.1",
        device: {
          id: "device-1",
          type: "desktop",
          isMobile: false,
          userAgent: "test-agent",
          platform: "test-os",
        },
      },
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

describe("BookingsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
  });

  it("creates booking requests for postings and publishes recommendation activity", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: RENTER_ONE_ID }));
    const create = jest.fn(async () => ({
      id: BOOKING_ONE_ID,
      postingId: POSTING_ID,
      status: "pending",
    }));
    const publishBookingRequestCreated = jest.fn(async () => undefined);
    const controller = new BookingsController(
      {
        create,
      } as any,
      {
        publishBookingRequestCreated,
      } as any,
    );

    const response = await invoke(
      controller.createForPosting,
      createContext({
        params: {
          id: POSTING_ID,
        },
        body: {
          startAt: "2099-05-01T00:00:00.000Z",
          endAt: "2099-05-04T00:00:00.000Z",
          guestCount: 2,
          note: "Can arrive after 6pm.",
          contactName: "Jordan Lee",
          contactEmail: "jordan@example.com",
          contactPhoneNumber: "1234567890",
        },
      }),
    );

    expect(create).toHaveBeenCalledWith({
      postingId: POSTING_ID,
      renterId: RENTER_ONE_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      guestCount: 2,
      note: "Can arrive after 6pm.",
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      contactPhoneNumber: "1234567890",
    });
    expect(publishBookingRequestCreated).toHaveBeenCalledWith({
      bookingRequest: {
        id: BOOKING_ONE_ID,
        postingId: POSTING_ID,
        status: "pending",
      },
      client: expect.any(Object),
      requestId: "request-1",
    });
    expect(response.status).toBe(201);
  });

  it("quotes bookings for postings and normalizes nullable notes", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: RENTER_TWO_ID }));
    const quote = jest.fn(async () => ({
      bookingRequestId: "quote-1",
      estimatedTotal: 240,
    }));
    const controller = new BookingsController(
      {
        quote,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.quoteForPosting,
      createContext({
        params: {
          id: POSTING_TWO_ID,
        },
        body: {
          startAt: "2099-06-01T00:00:00.000Z",
          endAt: "2099-06-03T00:00:00.000Z",
          guestCount: 1,
        },
      }),
    );

    expect(quote).toHaveBeenCalledWith({
      postingId: POSTING_TWO_ID,
      renterId: RENTER_TWO_ID,
      startAt: "2099-06-01T00:00:00.000Z",
      endAt: "2099-06-03T00:00:00.000Z",
      guestCount: 1,
      note: null,
    });
    expect(response.status).toBe(200);
  });

  it("lists owned booking requests for owner accounts", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ONE_ID, role: "owner" }),
    );
    const listOwned = jest.fn(async () => ({
      bookingRequests: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    }));
    const controller = new BookingsController(
      {
        listOwned,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.listOwned,
      createContext({
        url: "https://example.test/booking-requests/owner?page=1&pageSize=20",
      }),
    );

    expect(listOwned).toHaveBeenCalledWith({
      actorUserId: OWNER_ONE_ID,
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(response.status).toBe(200);
  });

  it("lists the caller's booking requests and owner-posting booking requests", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: RENTER_ONE_ID }));
    const listMine = jest.fn(async () => ({
      bookingRequests: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    }));
    const listForOwnerPosting = jest.fn(async () => ({
      bookingRequests: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    }));
    const controller = new BookingsController(
      {
        listMine,
        listForOwnerPosting,
      } as any,
      {} as any,
    );

    const mineResponse = await invoke(
      controller.listMine,
      createContext({
        url: "https://example.test/booking-requests/me?page=2&pageSize=5&status=pending",
      }),
    );
    const ownerPostingResponse = await invoke(
      controller.listForOwnerPosting,
      createContext({
        params: {
          id: POSTING_ID,
        },
        url: "https://example.test/postings/posting-1/booking-requests?page=1&pageSize=10&status=approved",
      }),
    );

    expect(listMine).toHaveBeenCalledWith({
      renterId: RENTER_ONE_ID,
      page: 2,
      pageSize: 5,
      status: "pending",
    });
    expect(listForOwnerPosting).toHaveBeenCalledWith({
      actorUserId: RENTER_ONE_ID,
      postingId: POSTING_ID,
      page: 1,
      pageSize: 10,
      status: "approved",
    });
    expect(mineResponse.status).toBe(200);
    expect(ownerPostingResponse.status).toBe(200);
  });

  it("maps renter dashboard query params into dashboardMine inputs", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: RENTER_ONE_ID }));
    const dashboardMine = jest.fn(async () => ({
      summary: {
        upcoming: 0,
        active: 0,
        pending: 0,
        actionNeeded: 1,
        past: 0,
        cancelled: 0,
      },
      items: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      filters: {
        page: 2,
        pageSize: 5,
        sort: "urgency",
        bucket: "action_needed",
        status: "awaiting_payment",
      },
    }));
    const controller = new BookingsController(
      {
        dashboardMine,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.dashboardMine,
      createContext({
        url: "https://example.test/booking-requests/me/dashboard?page=2&pageSize=5&sort=urgency&bucket=action_needed&status=awaiting_payment",
      }),
    );

    expect(dashboardMine).toHaveBeenCalledWith({
      renterId: RENTER_ONE_ID,
      page: 2,
      pageSize: 5,
      sort: "urgency",
      bucket: "action_needed",
      status: "awaiting_payment",
    });
    expect(response.status).toBe(200);
  });

  it("maps owner dashboard query params into dashboardOwned inputs", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ONE_ID, role: "owner" }),
    );
    const dashboardOwned = jest.fn(async () => ({
      summary: {
        approval: 1,
        payment: 0,
        expiringHold: 1,
        paymentFailure: 0,
        conversion: 0,
        upcomingRentings: 0,
        activeRentings: 0,
        pastRentings: 0,
        totalOpen: 1,
      },
      items: [],
      postings: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      filters: {
        page: 1,
        pageSize: 10,
        sort: "start_at",
        status: "pending",
        actionNeeded: "approval",
        postingId: POSTING_ID,
      },
    }));
    const controller = new BookingsController(
      {
        dashboardOwned,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.dashboardOwned,
      createContext({
        url: `https://example.test/booking-requests/owner/dashboard?sort=start_at&status=pending&actionNeeded=approval&postingId=${POSTING_ID}`,
      }),
    );

    expect(dashboardOwned).toHaveBeenCalledWith({
      actorUserId: OWNER_ONE_ID,
      page: 1,
      pageSize: 20,
      sort: "start_at",
      status: "pending",
      actionNeeded: "approval",
      postingId: POSTING_ID,
    });
    expect(response.status).toBe(200);
  });

  it("returns cancellation quotes for accessible booking requests", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: USER_ID }));
    const getCancellationQuote = jest.fn(async () => ({
      bookingRequestId: BOOKING_ONE_ID,
      cancellable: true,
      actor: "renter",
      bookingStatus: "paid",
      reasonRequired: false,
      policyCode: "platform_default_v1",
      refundType: "full",
      refundAmount: 330,
      currency: "CAD",
      failureReasons: [],
    }));
    const controller = new BookingsController(
      {
        getCancellationQuote,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.getCancellationQuote,
      createContext({
        params: {
          id: BOOKING_ONE_ID,
        },
      }),
    );

    expect(getCancellationQuote).toHaveBeenCalledWith(BOOKING_ONE_ID, USER_ID);
    expect(response.status).toBe(200);
  });

  it("gets, updates, approves, and declines booking requests", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_TWO_ID, role: "owner" }),
    );
    const getById = jest.fn(async () => ({
      id: BOOKING_TWO_ID,
      status: "pending",
    }));
    const updateOwnPending = jest.fn(async () => ({
      id: BOOKING_TWO_ID,
      status: "pending",
    }));
    const approve = jest.fn(async () => ({
      id: BOOKING_TWO_ID,
      status: "approved",
    }));
    const decline = jest.fn(async () => ({
      id: BOOKING_TWO_ID,
      status: "declined",
    }));
    const controller = new BookingsController(
      {
        getById,
        updateOwnPending,
        approve,
        decline,
      } as any,
      {} as any,
    );

    const getResponse = await invoke(
      controller.getById,
      createContext({
        params: {
          id: BOOKING_TWO_ID,
        },
      }),
    );
    const updateResponse = await invoke(
      controller.updateOwn,
      createContext({
        params: {
          id: BOOKING_TWO_ID,
        },
        body: {
          startAt: "2099-07-01T00:00:00.000Z",
          endAt: "2099-07-04T00:00:00.000Z",
          guestCount: 3,
          note: "Updated note",
          contactName: "Updated Guest",
          contactEmail: "updated@example.com",
        },
      }),
    );
    const approveResponse = await invoke(
      controller.approve,
      createContext({
        params: {
          id: BOOKING_TWO_ID,
        },
        body: {
          note: "Approved quickly",
        },
      }),
    );
    const declineResponse = await invoke(
      controller.decline,
      createContext({
        params: {
          id: BOOKING_TWO_ID,
        },
        body: {},
      }),
    );

    expect(getById).toHaveBeenCalledWith(BOOKING_TWO_ID, OWNER_TWO_ID);
    expect(updateOwnPending).toHaveBeenCalledWith({
      bookingRequestId: BOOKING_TWO_ID,
      renterId: OWNER_TWO_ID,
      startAt: "2099-07-01T00:00:00.000Z",
      endAt: "2099-07-04T00:00:00.000Z",
      guestCount: 3,
      note: "Updated note",
      contactName: "Updated Guest",
      contactEmail: "updated@example.com",
      contactPhoneNumber: null,
    });
    expect(approve).toHaveBeenCalledWith({
      bookingRequestId: BOOKING_TWO_ID,
      actorUserId: OWNER_TWO_ID,
      note: "Approved quickly",
    });
    expect(decline).toHaveBeenCalledWith({
      bookingRequestId: BOOKING_TWO_ID,
      actorUserId: OWNER_TWO_ID,
      note: null,
    });
    expect(getResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(approveResponse.status).toBe(200);
    expect(declineResponse.status).toBe(200);
  });

  it("routes booking cancellation reason and actor user id", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ONE_ID, role: "owner" }),
    );
    const cancel = jest.fn(async () => ({
      id: BOOKING_ONE_ID,
      status: "cancelled",
      posting: {
        id: POSTING_ID,
        name: "Loft",
        effectiveMaxBookingDurationDays: 30,
      },
      postingId: POSTING_ID,
      renterId: RENTER_ONE_ID,
      ownerId: OWNER_ONE_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      durationDays: 3,
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      pricingCurrency: "CAD",
      pricingSnapshot: {
        currency: "CAD",
        daily: {
          amount: 120,
        },
      },
      dailyPriceAmount: 120,
      estimatedTotal: 360,
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
      createdAt: "2099-04-20T00:00:00.000Z",
      updatedAt: "2099-04-20T00:00:00.000Z",
    }));
    const controller = new BookingsController(
      {
        cancel,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.cancel,
      createContext({
        params: {
          id: BOOKING_ONE_ID,
        },
        body: {
          reason: "Pipe burst in the unit.",
        },
      }),
    );

    expect(cancel).toHaveBeenCalledWith({
      bookingRequestId: BOOKING_ONE_ID,
      actorUserId: OWNER_ONE_ID,
      reason: "Pipe burst in the unit.",
    });
    expect(response.status).toBe(200);
  });

  it("wraps invalid booking query params in request validation errors", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: USER_3_ID }));
    const listMine = jest.fn();
    const controller = new BookingsController(
      {
        listMine,
      } as any,
      {} as any,
    );

    await expect(
      invoke(
        controller.listMine,
        createContext({
          url: "https://example.test/booking-requests/me?page=0&pageSize=two",
        }),
      ),
    ).rejects.toMatchObject<Partial<Error>>({
      message: "Request query validation failed.",
    });
    expect(listMine).not.toHaveBeenCalled();
  });
});
