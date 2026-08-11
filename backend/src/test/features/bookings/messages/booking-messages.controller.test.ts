import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { BookingMessagesController } from "@/features/bookings/messages/booking-messages.controller";
import type { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";
import type { TokenService } from "@/features/auth/token/token.service";

const mockRequireJwtAuth = jest.fn();
const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
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

function createContext(options?: { body?: unknown; url?: string }) {
  // `setCookie` writes through `c.header(...)`, so the fake has to collect
  // headers and hand them to the Response for the assertions to see them.
  const headers = new Headers();

  const context = {
    header: (name: string, value: string, opts?: { append?: boolean }) => {
      if (opts?.append) {
        headers.append(name, value);
        return;
      }

      headers.set(name, value);
    },
    req: {
      json: async () => options?.body ?? {},
      url:
        options?.url ??
        "https://example.test/booking-requests/booking-1/messages",
      param: (name?: string) =>
        name ? { id: "booking-1" }[name] : { id: "booking-1" },
    },
    get: (name?: string) => {
      if (name === "requestId") {
        return "request-1";
      }

      return {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      };
    },
    json: (body: unknown, status = 200) => {
      const responseHeaders = new Headers(headers);
      responseHeaders.set("content-type", "application/json");

      return new Response(JSON.stringify(body), {
        status,
        headers: responseHeaders,
      });
    },
  };

  return context as unknown as Context<AppBindings>;
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    send: jest.fn(async () => ({ id: "message-1" })),
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
      bookingRequestId: "booking-1",
      markedCount: 2,
      readAt: "2026-08-10T12:00:00.000Z",
    })),
    authorizeStream: jest.fn(async () => ({
      bookingRequestId: "booking-1",
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
        controller.send(createContext({ body: payload })),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("accepts a body at the maximum length and trims it", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );
      const body = "x".repeat(2000);

      const response = await controller.send(
        createContext({ body: { body: ` ${body} ` } }),
      );

      expect(response.status).toBe(201);
      expect(service.send).toHaveBeenCalledWith({
        bookingRequestId: "booking-1",
        authorId: "user-1",
        body,
      });

      const payload = await response.json();
      expect(payload).toMatchObject({
        success: true,
        message: "Message sent successfully.",
        data: { id: "message-1" },
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

      const response = await controller.list(createContext());

      expect(response.status).toBe(200);
      expect(service.list).toHaveBeenCalledWith({
        bookingRequestId: "booking-1",
        actorUserId: "user-1",
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

      await controller.list(
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
        controller.list(
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

      const response = await controller.list(createContext());
      const payload = await response.json();

      expect(payload.meta.pagination).toMatchObject({ page: 1, total: 0 });
    });
  });

  describe("socketTicket", () => {
    it("issues a ticket for a session-authenticated participant", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createTokenService(),
      );

      const response = await controller.socketTicket(createContext());
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(service.createSocketTicket).toHaveBeenCalledWith(
        "booking-1",
        "user-1",
      );
      // Delivered as a scoped HttpOnly cookie, never echoed in the body.
      expect(payload.data).toEqual({ expiresInSeconds: 30 });
      expect(response.headers.get("set-cookie")).toContain(
        "rentify_ws_ticket=ticket-1",
      );
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
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

      await expect(controller.socketTicket(createContext())).rejects.toBe(
        patError,
      );
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

      const response = await controller.markRead(createContext());
      const payload = await response.json();

      expect(service.markRead).toHaveBeenCalledWith("booking-1", "user-1");
      expect(payload).toMatchObject({
        message: "Messages marked as read.",
        data: { markedCount: 2 },
      });
    });
  });
});
