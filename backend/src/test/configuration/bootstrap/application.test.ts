const mockMountRoutes = jest.fn();
const mockGetApiRoutePrefix = jest.fn(() => "/api/v1");
const mockHonoConstructor = jest.fn();

jest.mock("hono", () => ({
  Hono: function Hono(...args: unknown[]) {
    return mockHonoConstructor(...args);
  },
}));

jest.mock("@/configuration/bootstrap/routes", () => ({
  mountRoutes: (...args: unknown[]) => mockMountRoutes(...args),
}));

jest.mock("@/configuration/http/api-path", () => ({
  getApiRoutePrefix: (...args: unknown[]) => mockGetApiRoutePrefix(...args),
}));

jest.mock("@/configuration/middlewares/client-context.middleware", () => ({
  clientContextMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/container-scope.middleware", () => ({
  containerScopeMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/cors.middleware", () => ({
  corsMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/csrf.middleware", () => ({
  csrfMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/error-handler.middleware", () => ({
  handleApplicationError: jest.fn(),
}));

jest.mock("@/configuration/middlewares/http-logging.middleware", () => ({
  httpLoggingMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/idempotency.middleware", () => ({
  idempotencyMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/output-format.middleware", () => ({
  outputFormatMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/rate-limiter.middleware", () => ({
  rateLimiterMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/request-body-policy.middleware", () => ({
  requestBodyPolicyMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/request-id.middleware", () => ({
  requestIdMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/request-logger.middleware", () => ({
  requestLoggerMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/request-sanitization.middleware", () => ({
  requestSanitizationMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/request-timeout.middleware", () => ({
  requestTimeoutMiddleware: jest.fn(),
}));

jest.mock("@/configuration/middlewares/security-headers.middleware", () => ({
  securityHeadersMiddleware: jest.fn(),
}));

describe("createApplication", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("registers API middleware in the expected order and returns the mounted app", async () => {
    const mockApi = {
      use: jest.fn(),
    };
    const mockApp = {
      basePath: jest.fn(() => mockApi),
      onError: jest.fn(),
    };
    const mountedApp = {
      id: "mounted-app",
    };

    mockHonoConstructor.mockReturnValue(mockApp);
    mockMountRoutes.mockReturnValue(mountedApp);

    const { createApplication } = await import(
      "@/configuration/bootstrap/application"
    );

    const result = createApplication();

    expect(mockApp.basePath).toHaveBeenCalledWith("/api/v1");
    expect(mockApi.use.mock.calls.map(([path]) => path)).toEqual([
      "*",
      "*",
      "*",
      "*",
      "*",
      "*",
      "*",
      "*",
      "/auth/*",
      "/auth/*",
      "/payments/*",
      "/booking-requests/:id/payment-session",
      "*",
      "*",
      "*",
      "*",
    ]);
    for (const call of mockApi.use.mock.calls) {
      expect(call[1]).toEqual(expect.any(Function));
    }
    expect(mockApp.onError).toHaveBeenCalledWith(expect.any(Function));
    expect(mockMountRoutes).toHaveBeenCalledWith(mockApp);
    expect(result).toBe(mountedApp);
  });
});
