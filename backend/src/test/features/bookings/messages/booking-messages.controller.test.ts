import { Hono } from "hono";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import type { JwtClaims } from "@/features/auth/token/token.service";
import type { BookingMessageStreamHub } from "@/features/bookings/messages/booking-message-stream.hub";
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
  const context = {
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
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
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
    ...overrides,
  } as unknown as BookingMessagesService;
}

function createTokenService(overrides: Record<string, unknown> = {}) {
  return {
    verifyAccessToken: jest.fn(async () => createClaims()),
    ...overrides,
  } as unknown as TokenService;
}

function createHub(overrides: Record<string, unknown> = {}) {
  return {
    subscribe: jest.fn(async () => async () => undefined),
    ...overrides,
  } as unknown as BookingMessageStreamHub;
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
        createHub(),
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
        createHub(),
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
        createHub(),
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
        createHub(),
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
        createHub(),
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
        createHub(),
        createTokenService(),
      );

      const response = await controller.list(createContext());
      const payload = await response.json();

      expect(payload.meta.pagination).toMatchObject({ page: 1, total: 0 });
    });
  });

  describe("markRead", () => {
    it("returns the marked count", async () => {
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createHub(),
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

  describe("stream", () => {
    function mountStream(
      service: BookingMessagesService,
      hub: BookingMessageStreamHub,
      tokenService?: TokenService,
    ) {
      const controller = new BookingMessagesController(
        service,
        hub,
        tokenService ?? createTokenService(),
      );
      const app = new Hono<AppBindings>();
      // Stands in for containerScopeMiddleware, which route-param sanitization
      // resolves the content sanitizer from.
      app.use("*", async (context, next) => {
        context.set("container", {
          resolve: () => ({ inspectRequest: () => [] }),
        } as never);
        await next();
      });
      app.get("/booking-requests/:id/messages/stream", (context) =>
        controller.stream(context as unknown as Context<AppBindings>),
      );

      return app;
    }

    it("authorizes before opening the stream and emits a ready frame", async () => {
      const order: string[] = [];
      const service = createService({
        authorizeStream: jest.fn(async () => {
          order.push("authorize");
          return { bookingRequestId: "booking-1", side: "renter" as const };
        }),
      });
      const hub = createHub({
        subscribe: jest.fn(async () => {
          order.push("subscribe");
          return async () => undefined;
        }),
      });
      mockRequireSessionAuth.mockImplementation(async () => {
        order.push("auth");
        return createClaims();
      });

      const response = await mountStream(service, hub).request(
        "http://rent.test/booking-requests/booking-1/messages/stream",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const chunk = await reader.read();
      const frame = decoder.decode(chunk.value);

      expect(frame).toContain("event: ready");
      // Authorization must complete before the stream subscribes.
      expect(order).toEqual(["auth", "authorize", "subscribe"]);

      await reader.cancel();
    });

    it("pushes published events to the client", async () => {
      let publish: ((event: unknown) => void) | undefined;
      const hub = createHub({
        subscribe: jest.fn(async (_id: string, listener: any) => {
          publish = listener;
          return async () => undefined;
        }),
      });

      const response = await mountStream(createService(), hub).request(
        "http://rent.test/booking-requests/booking-1/messages/stream",
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      await reader.read();

      publish?.({
        type: "message.created",
        bookingRequestId: "booking-1",
        message: { id: "message-9" },
      });

      const chunk = await reader.read();
      const frame = decoder.decode(chunk.value);

      expect(frame).toContain("event: message.created");
      expect(frame).toContain("message-9");
      expect(frame).toContain("id: message-9");

      await reader.cancel();
    });

    it("releases the subscription when the client disconnects", async () => {
      const release = jest.fn(async () => undefined);
      const hub = createHub({ subscribe: jest.fn(async () => release) });

      const response = await mountStream(createService(), hub).request(
        "http://rent.test/booking-requests/booking-1/messages/stream",
      );

      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();

      // Cancelling the reader aborts the stream, which must run teardown.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases a subscription that resolves after the client disconnected", async () => {
      const release = jest.fn(async () => undefined);
      let resolveSubscribe: (value: () => Promise<void>) => void = () => {};
      const hub = createHub({
        subscribe: jest.fn(
          () =>
            new Promise<() => Promise<void>>((resolve) => {
              resolveSubscribe = resolve;
            }),
        ),
      });

      const response = await mountStream(createService(), hub).request(
        "http://rent.test/booking-requests/booking-1/messages/stream",
      );

      // Disconnect while subscribe() is still pending, then let it resolve.
      await response.body!.cancel();
      resolveSubscribe(release);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(release).toHaveBeenCalledTimes(1);
    });

    it("closes an open stream once the viewer's access is revoked", async () => {
      jest.useFakeTimers();

      try {
        const release = jest.fn(async () => undefined);
        const authorizeStream = jest
          .fn()
          .mockResolvedValueOnce({
            bookingRequestId: "booking-1",
            side: "owner" as const,
          })
          // The membership was removed while the stream was held open.
          .mockRejectedValue(
            Object.assign(new Error("forbidden"), { status: 403 }),
          );
        const service = createService({ authorizeStream });
        const hub = createHub({ subscribe: jest.fn(async () => release) });

        const response = await mountStream(service, hub).request(
          "http://rent.test/booking-requests/booking-1/messages/stream",
        );

        expect(response.status).toBe(200);
        expect(authorizeStream).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(60_000);

        expect(authorizeStream).toHaveBeenCalledTimes(2);
        // Revocation must tear the connection down, not just stop writing.
        expect(release).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("closes an open stream once the session is revoked", async () => {
      jest.useFakeTimers();

      try {
        const release = jest.fn(async () => undefined);
        // Still a booking participant, but logged out or session-revoked, which
        // every REST call would already reject.
        const tokenService = createTokenService({
          verifyAccessToken: jest.fn().mockRejectedValue(
            Object.assign(new Error("Session is no longer active."), {
              status: 401,
            }),
          ),
        });
        const service = createService();
        const hub = createHub({ subscribe: jest.fn(async () => release) });

        await mountStream(service, hub, tokenService).request(
          "http://rent.test/booking-requests/booking-1/messages/stream",
        );

        await jest.advanceTimersByTimeAsync(60_000);

        expect(tokenService.verifyAccessToken).toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps a stream open while the viewer still has access", async () => {
      jest.useFakeTimers();

      try {
        const release = jest.fn(async () => undefined);
        const service = createService();
        const hub = createHub({ subscribe: jest.fn(async () => release) });

        await mountStream(service, hub).request(
          "http://rent.test/booking-requests/booking-1/messages/stream",
        );

        await jest.advanceTimersByTimeAsync(60_000);

        expect(service.authorizeStream).toHaveBeenCalledTimes(2);
        expect(release).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("propagates an authorization failure instead of opening a stream", async () => {
      const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
      const service = createService({
        authorizeStream: jest.fn(async () => {
          throw forbidden;
        }),
      });
      const hub = createHub();
      const controller = new BookingMessagesController(
        service,
        hub,
        createTokenService(),
      );

      await expect(controller.stream(createContext())).rejects.toBe(forbidden);
      expect(hub.subscribe).not.toHaveBeenCalled();
    });

    it("rejects personal access tokens", async () => {
      const patError = Object.assign(new Error("session required"), {
        status: 403,
      });
      mockRequireSessionAuth.mockRejectedValue(patError);
      const service = createService();
      const controller = new BookingMessagesController(
        service,
        createHub(),
        createTokenService(),
      );

      await expect(controller.stream(createContext())).rejects.toBe(patError);
      expect(service.authorizeStream).not.toHaveBeenCalled();
    });

    it("closes the stream when the subscription cannot be established", async () => {
      const hub = createHub({
        subscribe: jest.fn(async () => {
          throw new Error("redis down");
        }),
      });

      const response = await mountStream(createService(), hub).request(
        "http://rent.test/booking-requests/booking-1/messages/stream",
      );

      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const chunk = await reader.read();

      // No ready frame is emitted; the stream terminates instead of hanging.
      expect(chunk.done).toBe(true);
    });
  });
});
