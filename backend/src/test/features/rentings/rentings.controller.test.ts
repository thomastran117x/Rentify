import { createTestContext, invoke } from "../../support/mock-http";
import { RequestValidationError } from "@/configuration/validation/request";
import { RentingsController } from "@/features/rentings/rentings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { testUuid } from "../../support/uuid";

const RENTING_ID = testUuid(3100, 1);
const OWNER_ID = testUuid(1000, 1);
const USER_ID = testUuid(1000, 2);
const RENTER_ID = testUuid(1000, 3);
const BOOKING_ID = testUuid(1020, 1);

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: USER_ID,
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
  return createTestContext({
    body: options?.body,
    params: options?.params,
    url: options?.url ?? "https://example.test/rentings/renting-1",
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

describe("RentingsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
  });

  it("publishes renting confirmation after converting a booking request", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ID, role: "owner" }),
    );
    const convertApprovedBookingRequest = jest.fn(async () => ({
      id: RENTING_ID,
    }));
    const publishRentingConfirmed = jest.fn(async () => undefined);
    const controller = new RentingsController(
      {
        convertApprovedBookingRequest,
      } as any,
      {
        publishRentingConfirmed,
      } as any,
    );

    const response = await invoke(
      controller.convertBookingRequest,
      createContext({
        params: {
          id: BOOKING_ID,
        },
      }),
    );

    expect(convertApprovedBookingRequest).toHaveBeenCalledWith({
      bookingRequestId: BOOKING_ID,
      actorUserId: OWNER_ID,
    });
    expect(publishRentingConfirmed).toHaveBeenCalledWith({
      renting: {
        id: RENTING_ID,
      },
      client: expect.objectContaining({
        ip: "127.0.0.1",
      }),
      requestId: "request-1",
    });
    expect(response.status).toBe(201);
  });

  it("loads an accessible renting by id for the authenticated user", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: USER_ID, role: "user" }),
    );
    const getById = jest.fn(async () => ({
      id: RENTING_ID,
    }));
    const controller = new RentingsController(
      {
        getById,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.getById,
      createContext({
        params: {
          id: RENTING_ID,
        },
      }),
    );

    expect(getById).toHaveBeenCalledWith(RENTING_ID, USER_ID, "user");
    expect(response.status).toBe(200);
  });

  it("maps list query params into listMine inputs", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: USER_ID }));
    const listMine = jest.fn(async () => ({
      rentings: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      status: "active",
    }));
    const controller = new RentingsController(
      {
        listMine,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.listMine,
      createContext({
        url: "https://example.test/rentings/me?page=2&pageSize=5&status=active",
      }),
    );

    expect(listMine).toHaveBeenCalledWith({
      userId: USER_ID,
      page: 2,
      pageSize: 5,
      status: "active",
    });
    expect(response.status).toBe(200);
  });

  it("rejects invalid renting list queries", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: USER_ID }));
    const controller = new RentingsController({} as any, {} as any);

    await expect(
      invoke(
        controller.listMine,
        createContext({
          url: "https://example.test/rentings/me?page=0&pageSize=999",
        }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("routes renting instruction updates to the service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ID, role: "owner" }),
    );
    const updateInstructions = jest.fn(async () => ({ id: RENTING_ID }));
    const controller = new RentingsController(
      {
        updateInstructions,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.updateInstructions,
      createContext({
        params: {
          id: RENTING_ID,
        },
        body: {
          pickupInstructions: "Meet outside.",
          returnInstructions: "Return to concierge.",
        },
      }),
    );

    expect(updateInstructions).toHaveBeenCalledWith({
      rentingId: RENTING_ID,
      actorUserId: OWNER_ID,
      actorRole: "owner",
      pickupInstructions: "Meet outside.",
      returnInstructions: "Return to concierge.",
    });
    expect(response.status).toBe(200);
  });

  it("marks a renting as check-in ready through the service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ID, role: "owner" }),
    );
    const markCheckInReady = jest.fn(async () => ({ id: RENTING_ID }));
    const controller = new RentingsController(
      {
        markCheckInReady,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.markCheckInReady,
      createContext({
        params: {
          id: RENTING_ID,
        },
      }),
    );

    expect(markCheckInReady).toHaveBeenCalledWith({
      rentingId: RENTING_ID,
      actorUserId: OWNER_ID,
      actorRole: "owner",
    });
    expect(response.status).toBe(200);
  });

  it("marks a renting check-in as complete through the service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ID, role: "owner" }),
    );
    const markCheckInComplete = jest.fn(async () => ({ id: RENTING_ID }));
    const controller = new RentingsController(
      {
        markCheckInComplete,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.markCheckInComplete,
      createContext({
        params: {
          id: RENTING_ID,
        },
      }),
    );

    expect(markCheckInComplete).toHaveBeenCalledWith({
      rentingId: RENTING_ID,
      actorUserId: OWNER_ID,
      actorRole: "owner",
    });
    expect(response.status).toBe(200);
  });

  it("marks a renting return as complete through the service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: OWNER_ID, role: "owner" }),
    );
    const markCompleted = jest.fn(async () => ({ id: RENTING_ID }));
    const controller = new RentingsController(
      {
        markCompleted,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.markCompleted,
      createContext({
        params: {
          id: RENTING_ID,
        },
      }),
    );

    expect(markCompleted).toHaveBeenCalledWith({
      rentingId: RENTING_ID,
      actorUserId: OWNER_ID,
      actorRole: "owner",
    });
    expect(response.status).toBe(200);
  });

  it("routes dispute creation through the renting service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: RENTER_ID, role: "user" }),
    );
    const createDispute = jest.fn(async () => ({ id: RENTING_ID }));
    const controller = new RentingsController(
      {
        createDispute,
      } as any,
      {} as any,
    );

    const response = await invoke(
      controller.createDispute,
      createContext({
        params: {
          id: RENTING_ID,
        },
        body: {
          reason: "Condition mismatch",
          details: "The item arrived damaged.",
        },
      }),
    );

    expect(createDispute).toHaveBeenCalledWith({
      rentingId: RENTING_ID,
      actorUserId: RENTER_ID,
      actorRole: "user",
      reason: "Condition mismatch",
      details: "The item arrived damaged.",
    });
    expect(response.status).toBe(201);
  });
});
