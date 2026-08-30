import { createTestContext, invoke } from "../../../support/mock-http";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { BookingMessagesController } from "@/features/bookings/messages/booking-messages.controller";
import type { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";
import type { TokenService } from "@/features/auth/token/token.service";
import { testUuid } from "../../../support/uuid";

const BOOKING_ID = testUuid(1020, 1);
const USER_ID = testUuid(1000, 1);
const MESSAGE_ID = testUuid(1030, 1);

const mockRequireJwtAuth = jest.fn();
const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
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

/**
 * Route params and request-scoped state the middleware would normally have
 * populated. `createTestContext` builds the Express request/response pair; the
 * shared helper is used rather than a local fake so a change to the request
 * surface breaks here the same way it breaks everywhere else.
 */
function createContext(options?: { body?: unknown; url?: string }) {
  return createTestContext({
    method: "POST",
    url: options?.url ?? "/booking-requests/booking-1/messages",
    body: options?.body ?? {},
    params: { id: BOOKING_ID, messageId: MESSAGE_ID },
    state: {
      requestId: "request-1",
      container: { resolve: () => ({ inspectRequest: () => [] }) },
    },
  });
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    send: jest.fn(async () => ({ id: MESSAGE_ID })),
    list: jest.fn(async () => ({
      messages: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      unreadCount: 0,
    })),
    markRead: jest.fn(async () => ({
      bookingRequestId: BOOKING_ID,
      markedCount: 2,
      readAt: "2026-08-10T12:00:00.000Z",
    })),
    authorizeStream: jest.fn(async () => ({
      bookingRequestId: BOOKING_ID,
      side: "renter" as const,
    })),
    createSocketTicket: jest.fn(async () => ({
      ticket: "ticket-1",
      expiresInSeconds: 30,
    })),
    ...overrides,
  } as unknown as BookingMessagesService;
}

function createTokenService(overrides: Record<string, unknown> = {}) {
  return {
    verifyAccessToken: jest.fn(async () => createClaims()),
    ...overrides,
  } as unknown as TokenService;
}

describe("BookingMessagesController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireSessionAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    mockRequireSessionAuth.mockResolvedValue(createClaims());
  });

  describe("send", () => {
    it.each([
      ["a missing body", {}],
      ["an empty body", { body: "" }],
      ["a whitespace-only body", { body: "   " }],
      ["an over-long body", { body: "x".repeat(2001) }],
    ])("rejects %s", async (_label, payload) => {
      const controller = new BookingMessagesController(
        createService(),
        createTokenService(),
      );

      await expect(
        invoke(controller.send, createContext({ body: payload })),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("accepts a body at the maximum length and trims it", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );
      const body = "x".repeat(2000);

      const response = await invoke(
        controller.send,
        createContext({ body: { body: ` ${body} ` } }),
      );

      expect(response.status).toBe(201);
      expect(service.send).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        authorId: USER_ID,
        body,
      });

      const payload = await response.json();
      expect(payload).toMatchObject({
        success: true,
        message: "Message sent successfully.",
        data: { id: MESSAGE_ID },
      });
    });
  });

  describe("list", () => {
    it("applies pagination defaults", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      const response = await invoke(controller.list, createContext());

      expect(response.status).toBe(200);
      expect(service.list).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        actorUserId: USER_ID,
        page: 1,
        pageSize: 20,
      });
    });

    it("reads page and pageSize from the query string", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      await invoke(
        controller.list,
        createContext({
          url: "https://example.test/booking-requests/booking-1/messages?page=3&pageSize=5",
        }),
      );

      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, pageSize: 5 }),
      );
    });

    it("rejects a page size above the maximum", async () => {
      const controller = new BookingMessagesController(
        createService(),
        createTokenService(),
      );

      await expect(
        invoke(
          controller.list,
          createContext({
            url: "https://example.test/booking-requests/booking-1/messages?pageSize=999",
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("exposes pagination in the response meta", async () => {
      const controller = new BookingMessagesController(
        createService(),
        createTokenService(),
      );

      const response = await invoke(controller.list, createContext());
      const payload = await response.json();

      expect(payload.meta.pagination).toMatchObject({ page: 1, total: 0 });
    });
  });

  describe("edit and remove", () => {
    it("edits a message through the service", async () => {
      const service = createService({
        edit: jest.fn(async () => ({ id: MESSAGE_ID, body: "Updated" })),
      });
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      const response = await invoke(
        controller.edit,
        createContext({ body: { body: "Updated" } }),
      );

      expect(response.status).toBe(200);
      expect(service.edit).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        messageId: MESSAGE_ID,
        actorUserId: USER_ID,
        body: "Updated",
      });
    });

    it("rejects an edit with an empty body", async () => {
      const service = createService({ edit: jest.fn() });
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      await expect(
        invoke(controller.edit, createContext({ body: { body: "   " } })),
      ).rejects.toMatchObject({ status: 400 });
      expect(service.edit).not.toHaveBeenCalled();
    });

    it("deletes a message through the service", async () => {
      const service = createService({
        remove: jest.fn(async () => ({ id: MESSAGE_ID, deletedAt: "now" })),
      });
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      const response = await invoke(controller.remove, createContext());

      expect(response.status).toBe(200);
      expect(service.remove).toHaveBeenCalledWith({
        bookingRequestId: BOOKING_ID,
        messageId: MESSAGE_ID,
        actorUserId: USER_ID,
      });
    });
  });

  describe("socketTicket", () => {
    it("issues a ticket for a session-authenticated participant", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      const response = await invoke(controller.socketTicket, createContext());
      const payload = await response.json();

      expect(response.status).toBe(201);
      // The session travels with the ticket so the socket it opens can be
      // rechecked against a logout or a token-version bump later.
      expect(service.createSocketTicket).toHaveBeenCalledWith(
        BOOKING_ID,
        USER_ID,
        { sessionId: null, tokenVersion: 0 },
      );
      // Delivered as a scoped HttpOnly cookie, never echoed in the body.
      expect(payload.data).toEqual({ expiresInSeconds: 30 });
      expect(response.headers.get("set-cookie")).toContain(
        "rentify_ws_ticket=ticket-1",
      );
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain(
        "Path=/ws/booking-messages",
      );
    });

    it("forwards a real session id and token version", async () => {
      mockRequireSessionAuth.mockResolvedValue({
        ...createClaims(),
        sessionId: "session-9",
        tokenVersion: 4,
      });
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      await invoke(controller.socketTicket, createContext());

      expect(service.createSocketTicket).toHaveBeenCalledWith(
        BOOKING_ID,
        USER_ID,
        { sessionId: "session-9", tokenVersion: 4 },
      );
    });

    it("rejects a personal access token", async () => {
      const patError = Object.assign(new Error("session required"), {
        status: 403,
      });
      mockRequireSessionAuth.mockRejectedValue(patError);
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      await expect(
        invoke(controller.socketTicket, createContext()),
      ).rejects.toBe(patError);
      expect(service.createSocketTicket).not.toHaveBeenCalled();
    });
  });

  describe("markRead", () => {
    it("returns the marked count", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      const response = await invoke(controller.markRead, createContext());
      const payload = await response.json();

      expect(service.markRead).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
      expect(payload).toMatchObject({
        message: "Messages marked as read.",
        data: { markedCount: 2 },
      });
    });
  });
});
