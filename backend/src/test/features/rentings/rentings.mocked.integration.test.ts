import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { RentingsController } from "@/features/rentings/rentings.controller";
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

function createRenting(overrides: Record<string, unknown> = {}) {
  return {
    id: "renting-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterUserId: "user-1",
    ownerUserId: "owner-1",
    status: "confirmed",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createApp() {
  const rentingsService = {
    convertApprovedBookingRequest: jest.fn(async () => createRenting()),
    listMine: jest.fn(async () => ({
      rentings: [createRenting()],
      pagination: createPagination(),
    })),
    updateInstructions: jest.fn(async () =>
      createRenting({
        pickupInstructions: "Meet at the lobby desk.",
      }),
    ),
    markCheckInReady: jest.fn(async () =>
      createRenting({
        status: "check_in_ready",
      }),
    ),
    markCheckInComplete: jest.fn(async () =>
      createRenting({
        status: "active",
      }),
    ),
    markCompleted: jest.fn(async () =>
      createRenting({
        status: "completed",
      }),
    ),
    createDispute: jest.fn(async () => ({
      id: "dispute-1",
      rentingId: "renting-1",
      reason: "Missing equipment",
      details: "One monitor was missing at pickup.",
    })),
    getById: jest.fn(async () => createRenting()),
  };

  const recommendationActivityPublisher = {
    publishRentingConfirmed: jest.fn(async () => undefined),
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

      return createJwtClaims();
    }),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.rentingsController,
      new RentingsController(
        rentingsService as any,
        recommendationActivityPublisher as any,
      ),
    ],
    [containerTokens.tokenService, tokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    rentingsService,
    recommendationActivityPublisher,
  };
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("Rentings integration", () => {
  it("covers renting conversion, listing, detail, and lifecycle endpoints", async () => {
    const { app, rentingsService, recommendationActivityPublisher } =
      createApp();

    const convertResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/convert")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
      },
    );
    const listMineResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/me?page=1&pageSize=20&status=confirmed")}`,
      {
        headers: authHeaders("user-token"),
      },
    );
    const updateInstructionsResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/renting-1/instructions")}`,
      {
        method: "PUT",
        headers: authHeaders("owner-token"),
        body: JSON.stringify({
          pickupInstructions: "Meet at the lobby desk.",
          returnInstructions: "Leave the keys in the lockbox.",
        }),
      },
    );
    const checkInReadyResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/renting-1/check-in-ready")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
      },
    );
    const checkInResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/renting-1/check-in")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
      },
    );
    const returnResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/renting-1/return")}`,
      {
        method: "POST",
        headers: authHeaders("owner-token"),
      },
    );
    const disputeResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/renting-1/disputes")}`,
      {
        method: "POST",
        headers: authHeaders("user-token"),
        body: JSON.stringify({
          reason: "Missing equipment",
          details: "One monitor was missing at pickup.",
        }),
      },
    );
    const getByIdResponse = await app.request(
      `http://rent.test${buildApiPath("/rentings/renting-1")}`,
      {
        headers: authHeaders("owner-token"),
      },
    );

    expect(convertResponse.status).toBe(201);
    expect(listMineResponse.status).toBe(200);
    expect(updateInstructionsResponse.status).toBe(200);
    expect(checkInReadyResponse.status).toBe(200);
    expect(checkInResponse.status).toBe(200);
    expect(returnResponse.status).toBe(200);
    expect(disputeResponse.status).toBe(201);
    expect(getByIdResponse.status).toBe(200);

    expect(rentingsService.convertApprovedBookingRequest).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
    });
    expect(
      recommendationActivityPublisher.publishRentingConfirmed,
    ).toHaveBeenCalledTimes(1);
    expect(rentingsService.listMine).toHaveBeenCalledWith({
      userId: "user-1",
      page: 1,
      pageSize: 20,
      status: "confirmed",
    });
    expect(rentingsService.updateInstructions).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
      pickupInstructions: "Meet at the lobby desk.",
      returnInstructions: "Leave the keys in the lockbox.",
    });
    expect(rentingsService.markCheckInReady).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
    });
    expect(rentingsService.markCheckInComplete).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
    });
    expect(rentingsService.markCompleted).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
    });
    expect(rentingsService.createDispute).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "user-1",
      actorRole: "user",
      reason: "Missing equipment",
      details: "One monitor was missing at pickup.",
    });
    expect(rentingsService.getById).toHaveBeenCalledWith(
      "renting-1",
      "owner-1",
      "owner",
    );
  });
});
