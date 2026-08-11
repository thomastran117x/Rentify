import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { createTestApp } from "../../support/fetch-app";

jest.mock("@/configuration/environment", () => ({
  getOptionalEnvironmentVariable: jest.fn(),
}));

const mockGetOptionalEnvironmentVariable =
  getOptionalEnvironmentVariable as jest.MockedFunction<
    typeof getOptionalEnvironmentVariable
  >;

/**
 * The middleware used to read the peer address through @hono/node-server's
 * getConnInfo; it now reads the socket directly. Tests run over a real loopback
 * socket, so the address is overridden here to stand in for the peer the
 * scenario is about.
 */
function createApp(remoteAddress: string | undefined) {
  return createTestApp((app) => {
    app.use((request, _response, next) => {
      Object.defineProperty(request, "socket", {
        value: remoteAddress === undefined ? undefined : { remoteAddress },
        configurable: true,
      });
      next();
    });
    app.use(clientContextMiddleware);
    app.get("/client", (request, response) => {
      response.json(request.client);
    });
  });
}

describe("clientContextMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOptionalEnvironmentVariable.mockReturnValue(undefined);
  });

  it("uses the remote socket address when proxy headers are not trusted", async () => {
    const app = createApp("10.0.0.5");

    const response = await app.request("http://rent.test/client", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 10.0.0.5",
        "x-device-id": "device-1",
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"iOS"',
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ip: "10.0.0.5",
      device: {
        id: "device-1",
        type: "mobile",
        isMobile: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iOS",
      },
    });
  });

  it("prefers the first forwarded ip when trusted proxy headers are enabled", async () => {
    mockGetOptionalEnvironmentVariable.mockReturnValue("true");
    const app = createApp("10.0.0.5");

    const response = await app.request("http://rent.test/client", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 10.0.0.5",
        "user-agent": "curl/8.0.1",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ip: "203.0.113.9",
      device: {
        type: "bot",
        isMobile: false,
        userAgent: "curl/8.0.1",
      },
    });
  });

  it("falls back to alternate proxy headers and tolerates missing connection info", async () => {
    mockGetOptionalEnvironmentVariable.mockReturnValue("1");
    const app = createApp(undefined);

    const response = await app.request("http://rent.test/client", {
      headers: {
        "cf-connecting-ip": "198.51.100.7",
        "x-device-platform": "Linux",
        "user-agent":
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ip: "198.51.100.7",
      device: {
        type: "tablet",
        isMobile: false,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "Linux",
      },
    });
  });
});
