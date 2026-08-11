import { createLegacyTestContext } from "../../support/mock-http";
import { BookingsController } from "@/features/bookings/bookings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
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
  return createLegacyTestContext({
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
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "renter-1" }));
    const create = jest.fn(async () => ({
      id: "booking-1",
      postingId: "posting-1",
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

    const response = await controller.createForPosting(
      createContext({
        params: {
          id: "posting-1",
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
      postingId: "posting-1",
      renterId: "renter-1",
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
        id: "booking-1",
        postingId: "posting-1",
        status: "pending",
      },
      client: expect.any(Object),
      requestId: "request-1",
    });
    expect(response.status).toBe(201);
  });

  it("quotes bookings for postings and normalizes nullable notes", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "renter-2" }));
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

    const response = await controller.quoteForPosting(
      createContext({
        params: {
          id: "posting-2",
        },
        body: {
          startAt: "2099-06-01T00:00:00.000Z",
          endAt: "2099-06-03T00:00:00.000Z",
          guestCount: 1,
        },
      }),
    );

    expect(quote).toHaveBeenCalledWith({
      postingId: "posting-2",
      renterId: "renter-2",
      startAt: "2099-06-01T00:00:00.000Z",
      endAt: "2099-06-03T00:00:00.000Z",
      guestCount: 1,
      note: null,
    });
    expect(response.status).toBe(200);
  });

  it("lists owned booking requests for owner accounts", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: "owner-1", role: "owner" }),
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

    const response = await controller.listOwned(
      createContext({
        url: "https://example.test/booking-requests/owner?page=1&pageSize=20",
      }),
    );

    expect(listOwned).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(response.status).toBe(200);
  });

  it("lists the caller's booking requests and owner-posting booking requests", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "renter-1" }));
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

    const mineResponse = await controller.listMine(
      createContext({
        url: "https://example.test/booking-requests/me?page=2&pageSize=5&status=pending",
      }),
    );
    const ownerPostingResponse = await controller.listForOwnerPosting(
      createContext({
        params: {
          id: "posting-1",
        },
        url: "https://example.test/postings/posting-1/booking-requests?page=1&pageSize=10&status=approved",
      }),
    );

    expect(listMine).toHaveBeenCalledWith({
      renterId: "renter-1",
      page: 2,
      pageSize: 5,
      status: "pending",
    });
    expect(listForOwnerPosting).toHaveBeenCalledWith({
      actorUserId: "renter-1",
      organizationId: "",
      postingId: "posting-1",
      page: 1,
      pageSize: 10,
      status: "approved",
    });
    expect(mineResponse.status).toBe(200);
    expect(ownerPostingResponse.status).toBe(200);
  });

  it("maps renter dashboard query params into dashboardMine inputs", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "renter-1" }));
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

    const response = await controller.dashboardMine(
      createContext({
        url: "https://example.test/booking-requests/me/dashboard?page=2&pageSize=5&sort=urgency&bucket=action_needed&status=awaiting_payment",
      }),
    );

    expect(dashboardMine).toHaveBeenCalledWith({
      renterId: "renter-1",
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
      createClaims({ sub: "owner-1", role: "owner" }),
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
        postingId: "posting-1",
      },
    }));
    const controller = new BookingsController(
      {
        dashboardOwned,
      } as any,
      {} as any,
    );

    const response = await controller.dashboardOwned(
      createContext({
        url: "https://example.test/booking-requests/owner/dashboard?sort=start_at&status=pending&actionNeeded=approval&postingId=posting-1",
      }),
    );

    expect(dashboardOwned).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      sort: "start_at",
      status: "pending",
      actionNeeded: "approval",
      postingId: "posting-1",
    });
    expect(response.status).toBe(200);
  });

  it("returns cancellation quotes for accessible booking requests", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "user-1" }));
    const getCancellationQuote = jest.fn(async () => ({
      bookingRequestId: "booking-1",
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

    const response = await controller.getCancellationQuote(
      createContext({
        params: {
          id: "booking-1",
        },
      }),
    );

    expect(getCancellationQuote).toHaveBeenCalledWith("booking-1", "user-1");
    expect(response.status).toBe(200);
  });

  it("gets, updates, approves, and declines booking requests", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: "owner-2", role: "owner" }),
    );
    const getById = jest.fn(async () => ({
      id: "booking-2",
      status: "pending",
    }));
    const updateOwnPending = jest.fn(async () => ({
      id: "booking-2",
      status: "pending",
    }));
    const approve = jest.fn(async () => ({
      id: "booking-2",
      status: "approved",
    }));
    const decline = jest.fn(async () => ({
      id: "booking-2",
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

    const getResponse = await controller.getById(
      createContext({
        params: {
          id: "booking-2",
        },
      }),
    );
    const updateResponse = await controller.updateOwn(
      createContext({
        params: {
          id: "booking-2",
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
    const approveResponse = await controller.approve(
      createContext({
        params: {
          id: "booking-2",
        },
        body: {
          note: "Approved quickly",
        },
      }),
    );
    const declineResponse = await controller.decline(
      createContext({
        params: {
          id: "booking-2",
        },
        body: {},
      }),
    );

    expect(getById).toHaveBeenCalledWith("booking-2", "owner-2");
    expect(updateOwnPending).toHaveBeenCalledWith({
      bookingRequestId: "booking-2",
      renterId: "owner-2",
      startAt: "2099-07-01T00:00:00.000Z",
      endAt: "2099-07-04T00:00:00.000Z",
      guestCount: 3,
      note: "Updated note",
      contactName: "Updated Guest",
      contactEmail: "updated@example.com",
      contactPhoneNumber: null,
    });
    expect(approve).toHaveBeenCalledWith({
      bookingRequestId: "booking-2",
      actorUserId: "owner-2",
      note: "Approved quickly",
    });
    expect(decline).toHaveBeenCalledWith({
      bookingRequestId: "booking-2",
      actorUserId: "owner-2",
      note: null,
    });
    expect(getResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(approveResponse.status).toBe(200);
    expect(declineResponse.status).toBe(200);
  });

  it("routes booking cancellation reason and actor user id", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: "owner-1", role: "owner" }),
    );
    const cancel = jest.fn(async () => ({
      id: "booking-1",
      status: "cancelled",
      posting: {
        id: "posting-1",
        name: "Loft",
        effectiveMaxBookingDurationDays: 30,
      },
      postingId: "posting-1",
      renterId: "renter-1",
      ownerId: "owner-1",
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

    const response = await controller.cancel(
      createContext({
        params: {
          id: "booking-1",
        },
        body: {
          reason: "Pipe burst in the unit.",
        },
      }),
    );

    expect(cancel).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
      reason: "Pipe burst in the unit.",
    });
    expect(response.status).toBe(200);
  });

  it("wraps invalid booking query params in request validation errors", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "user-3" }));
    const listMine = jest.fn();
    const controller = new BookingsController(
      {
        listMine,
      } as any,
      {} as any,
    );

    await expect(
      controller.listMine(
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
