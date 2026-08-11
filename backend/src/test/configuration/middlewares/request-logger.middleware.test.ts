import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import { requestLoggerMiddleware } from "@/configuration/middlewares/request-logger.middleware";
import { createTestApp } from "../../support/fetch-app";

jest.mock("@/configuration/bootstrap/container", () => {
  const actual = jest.requireActual("@/configuration/bootstrap/container");
  return {
    ...actual,
    getRequestContainer: jest.fn(),
  };
});

const mockGetRequestContainer = getRequestContainer as jest.MockedFunction<
  typeof getRequestContainer
>;

function createApp() {
  return createTestApp((app) => {
    app.use((request, _response, next) => {
      request.requestId = "req-123";
      request.client = {
        ip: "203.0.113.9",
        device: {
          id: "device-1",
          type: "mobile",
          isMobile: true,
          platform: "iOS",
          userAgent: "Mozilla/5.0",
        },
      };
      next();
    });
    app.use(requestLoggerMiddleware);
    app.get("/request", (request, response) => {
      response
        .type("text/plain")
        .send(request.logger === requestLogger ? "ready" : "missing");
    });
  });
}

const requestLogger = {
  child: jest.fn(),
  critical: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

describe("requestLoggerMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a request-scoped logger enriched with request and client metadata", async () => {
    const child = jest.fn().mockReturnValue(requestLogger);
    const baseLogger = {
      child,
      critical: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    };
    const forComponent = jest.fn().mockReturnValue(baseLogger);
    const resolve = jest.fn().mockReturnValue({
      forClass: jest.fn(),
      forComponent,
      fromContext: jest.fn(),
    });
    mockGetRequestContainer.mockReturnValue({
      resolve,
    } as unknown as ReturnType<typeof getRequestContainer>);

    const app = createApp();
    const response = await app.request("http://rent.test/request");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ready");
    expect(resolve).toHaveBeenCalledWith(containerTokens.loggerFactory);
    expect(forComponent).toHaveBeenCalledWith("http-request", "request");
    expect(child).toHaveBeenCalledWith({
      requestId: "req-123",
      fields: {
        clientIp: "203.0.113.9",
        deviceId: "device-1",
        devicePlatform: "iOS",
        deviceType: "mobile",
        isMobile: true,
      },
    });
  });
});
