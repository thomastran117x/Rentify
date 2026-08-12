import type { RequestHandler } from "express";
import { createFetchApp } from "../../support/fetch-app";

const mockMountRoutes = jest.fn();
const mockOrder: string[] = [];

/**
 * Each middleware is replaced by a pass-through that records that it ran.
 *
 * The previous version of this test mocked Hono's constructor and inspected the
 * arguments passed to `app.use`. There is no equivalent to inspect on an
 * Express app without reaching into router internals, and asserting the order
 * the middleware actually executes in is a stronger check anyway: it covers the
 * path scoping too.
 */
function recordingMiddleware(name: string): RequestHandler {
  return (_request, _response, next) => {
    mockOrder.push(name);
    next();
  };
}

jest.mock("@/configuration/bootstrap/routes", () => ({
  mountRoutes: (api: unknown) => mockMountRoutes(api),
}));

jest.mock("@/configuration/middlewares/cors.middleware", () => ({
  corsMiddleware: recordingMiddleware("cors"),
}));

jest.mock("@/configuration/middlewares/request-id.middleware", () => ({
  requestIdMiddleware: recordingMiddleware("request-id"),
}));

jest.mock("@/configuration/middlewares/client-context.middleware", () => ({
  clientContextMiddleware: recordingMiddleware("client-context"),
}));

jest.mock("@/configuration/middlewares/container-scope.middleware", () => ({
  containerScopeMiddleware: recordingMiddleware("container-scope"),
}));

jest.mock("@/configuration/middlewares/request-logger.middleware", () => ({
  requestLoggerMiddleware: recordingMiddleware("request-logger"),
}));

jest.mock("@/configuration/middlewares/request-timeout.middleware", () => ({
  requestTimeoutMiddleware: recordingMiddleware("request-timeout"),
}));

jest.mock("@/configuration/middlewares/request-body-policy.middleware", () => ({
  requestBodyPolicyMiddleware: recordingMiddleware("request-body-policy"),
  readRequestBodyMaxBytes: () => 1024 * 1024,
}));

jest.mock(
  "@/configuration/middlewares/request-sanitization.middleware",
  () => ({
    requestSanitizationMiddleware: recordingMiddleware("request-sanitization"),
  }),
);

jest.mock("@/configuration/middlewares/csrf.middleware", () => ({
  csrfMiddleware: recordingMiddleware("csrf"),
}));

jest.mock("@/configuration/middlewares/idempotency.middleware", () => ({
  idempotencyMiddleware: recordingMiddleware("idempotency"),
}));

jest.mock("@/configuration/middlewares/rate-limiter.middleware", () => ({
  rateLimiterMiddleware: recordingMiddleware("rate-limiter"),
}));

jest.mock("@/configuration/middlewares/output-format.middleware", () => ({
  outputFormatMiddleware: recordingMiddleware("output-format"),
}));

jest.mock("@/configuration/middlewares/security-headers.middleware", () => ({
  securityHeadersMiddleware: recordingMiddleware("security-headers"),
}));

jest.mock("@/configuration/middlewares/http-logging.middleware", () => ({
  httpLoggingMiddleware: recordingMiddleware("http-logging"),
}));

// Must keep the four-argument shape: Express identifies error handlers by
// arity, and a shorter stub would silently be mounted as ordinary middleware.
jest.mock("@/configuration/middlewares/error-handler.middleware", () => ({
  handleApplicationError: (
    error: { status?: number },
    _request: unknown,
    response: { status: (code: number) => { json: (body: unknown) => void } },
    _next: unknown,
  ) => {
    response.status(error?.status ?? 500).json({ ok: false });
  },
}));

const GLOBAL_MIDDLEWARE = [
  "cors",
  "request-id",
  "client-context",
  "container-scope",
  "request-logger",
  "request-timeout",
  "request-body-policy",
  "request-sanitization",
];

const TRAILING_MIDDLEWARE = [
  "rate-limiter",
  "output-format",
  "security-headers",
  "http-logging",
];

async function createApp() {
  const { createApplication } = await import(
    "@/configuration/bootstrap/application"
  );

  return createFetchApp(createApplication());
}

describe("createApplication", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.length = 0;
    mockMountRoutes.mockImplementation((api: any) => {
      api.get("/ping", (_request: unknown, response: any) => {
        response.json({ ok: true });
      });
      api.post("/auth/refresh", (_request: unknown, response: any) => {
        response.json({ ok: true });
      });
      api.post(
        "/booking-requests/:id/payment-session",
        (_request: unknown, response: any) => {
          response.json({ ok: true });
        },
      );
    });
  });

  it("mounts the API under the versioned prefix", async () => {
    const app = await createApp();

    const response = await app.request("http://rent.test/api/v1/ping");

    expect(response.status).toBe(200);
    expect(mockMountRoutes).toHaveBeenCalledTimes(1);
  });

  it("does not serve API routes outside the versioned prefix", async () => {
    const app = await createApp();

    const response = await app.request("http://rent.test/ping");

    expect(response.status).toBe(404);
  });

  it("runs the global middleware in the expected order", async () => {
    const app = await createApp();

    await app.request("http://rent.test/api/v1/ping");

    expect(mockOrder).toEqual([...GLOBAL_MIDDLEWARE, ...TRAILING_MIDDLEWARE]);
  });

  it("applies the csrf and idempotency middleware to auth routes only", async () => {
    const app = await createApp();

    await app.request("http://rent.test/api/v1/auth/refresh", {
      method: "POST",
    });

    expect(mockOrder).toEqual([
      ...GLOBAL_MIDDLEWARE,
      "csrf",
      "idempotency",
      ...TRAILING_MIDDLEWARE,
    ]);

    mockOrder.length = 0;
    await app.request("http://rent.test/api/v1/ping");

    expect(mockOrder).not.toContain("csrf");
    expect(mockOrder).not.toContain("idempotency");
  });

  it("applies the idempotency middleware to the booking payment session route", async () => {
    const app = await createApp();

    await app.request(
      "http://rent.test/api/v1/booking-requests/booking-1/payment-session",
      { method: "POST" },
    );

    expect(mockOrder).toEqual([
      ...GLOBAL_MIDDLEWARE,
      "idempotency",
      ...TRAILING_MIDDLEWARE,
    ]);
  });

  it("answers an unmatched API route with a 404 rather than an html page", async () => {
    const app = await createApp();

    const response = await app.request("http://rent.test/api/v1/nope");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  // Express matches loosely and case-insensitively by default. Hono did not,
  // and the rate limiter keys off a strict lowercase pathname: letting
  // /auth/local/login/ or /AUTH/LOCAL/LOGIN through would drop those requests
  // into the default bucket instead of the stricter auth-sensitive one.
  describe("path matching", () => {
    it("does not match a route with a trailing slash", async () => {
      const app = await createApp();

      const response = await app.request("http://rent.test/api/v1/ping/");

      expect(response.status).toBe(404);
    });

    it("does not match a route whose case differs", async () => {
      const app = await createApp();

      const response = await app.request("http://rent.test/api/v1/PING");

      expect(response.status).toBe(404);
    });

    it("does not match a differently-cased api prefix", async () => {
      const app = await createApp();

      const response = await app.request("http://rent.test/API/V1/ping");

      expect(response.status).toBe(404);
    });

    it("still answers a missed mount with the error envelope", async () => {
      const app = await createApp();

      const response = await app.request("http://rent.test/API/V1/ping");

      expect(response.headers.get("content-type")).not.toContain("text/html");
    });
  });
});
