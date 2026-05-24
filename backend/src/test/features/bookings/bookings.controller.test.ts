import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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
  const context = {
    req: {
      json: async () => options?.body ?? {},
      url: options?.url ?? "https://example.test/booking-requests/me",
      param: (name?: string) => (name ? options?.params?.[name] : options?.params ?? {}),
    },
    get: (name?: string) => {
      if (name === "requestId") {
        return "request-1";
      }

      if (name === "client") {
        return {
          ip: "127.0.0.1",
          device: {
            id: "device-1",
            type: "desktop",
            isMobile: false,
            userAgent: "test-agent",
            platform: "test-os",
          },
        };
      }

      return {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      };
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

describe("BookingsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
  });

  it("lists owned booking requests for owner accounts", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "owner-1", role: "owner" }));
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
      } as never,
      {} as never,
    );

    const response = await controller.listOwned(
      createContext({
        url: "https://example.test/booking-requests/owner?page=1&pageSize=20",
      }),
    );

    expect(listOwned).toHaveBeenCalledWith({
      ownerId: "owner-1",
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(response.status).toBe(200);
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
      } as never,
      {} as never,
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
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "owner-1", role: "owner" }));
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
      } as never,
      {} as never,
    );

    const response = await controller.dashboardOwned(
      createContext({
        url: "https://example.test/booking-requests/owner/dashboard?sort=start_at&status=pending&actionNeeded=approval&postingId=posting-1",
      }),
    );

    expect(dashboardOwned).toHaveBeenCalledWith({
      ownerId: "owner-1",
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
      } as never,
      {} as never,
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

  it("routes booking cancellation reason and actor user id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "owner-1", role: "owner" }));
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
      } as never,
      {} as never,
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
});
