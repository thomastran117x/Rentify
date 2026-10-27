import { environment } from "@/configuration/environment";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { createTestApp } from "../../support/fetch-app";

jest.mock("@/configuration/environment", () => ({
  environment: {
    getApplicationConfig: jest.fn(),
    getHttpConfig: jest.fn(),
  },
}));

const mockGetApplicationConfig = environment.getApplicationConfig as jest.Mock;
const mockGetHttpConfig = environment.getHttpConfig as jest.Mock;

function httpConfig(overrides: Record<string, unknown> = {}) {
  return {
    trustedProxyHops: 0,
    trustedProxyCidrs: [],
    clientIpHeader: undefined,
    deprecatedTrustProxyHeaders: false,
    ...overrides,
  };
}

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
    mockGetApplicationConfig.mockReturnValue({
      frontendUrl: "http://localhost:3040",
    });
    mockGetHttpConfig.mockReturnValue(httpConfig());
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
      source: "unknown",
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

  it("takes the forwarded entry the trusted proxy appended, not the spoofable left-most one", async () => {
    mockGetHttpConfig.mockReturnValue(httpConfig({ trustedProxyHops: 1 }));
    const app = createApp("10.0.0.5");

    const response = await app.request("http://rent.test/client", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.77",
        "user-agent": "curl/8.0.1",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ip: "198.51.100.77",
      source: "api-tool",
      device: {
        type: "bot",
        isMobile: false,
        userAgent: "curl/8.0.1",
      },
    });
  });

  it("ignores vendor client-ip headers that are not configured", async () => {
    mockGetHttpConfig.mockReturnValue(httpConfig({ trustedProxyHops: 1 }));
    const app = createApp("10.0.0.5");

    const response = await app.request("http://rent.test/client", {
      headers: {
        "cf-connecting-ip": "198.51.100.7",
        "x-real-ip": "198.51.100.8",
        "true-client-ip": "198.51.100.9",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ip: "10.0.0.5" });
  });

  it("uses the configured client-ip header from a trusted proxy and tolerates missing connection info", async () => {
    mockGetHttpConfig.mockReturnValue(
      httpConfig({
        trustedProxyCidrs: ["10.0.0.0/8"],
        clientIpHeader: "cf-connecting-ip",
      }),
    );

    const trusted = await createApp("10.0.0.5").request(
      "http://rent.test/client",
      {
        headers: {
          "cf-connecting-ip": "198.51.100.7",
          "x-device-platform": "Linux",
          "user-agent":
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        },
      },
    );

    expect(trusted.status).toBe(200);
    await expect(trusted.json()).resolves.toEqual({
      ip: "198.51.100.7",
      source: "unknown",
      device: {
        type: "tablet",
        isMobile: false,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "Linux",
      },
    });

    const disconnected = await createApp(undefined).request(
      "http://rent.test/client",
      { headers: { "cf-connecting-ip": "198.51.100.7" } },
    );

    expect(disconnected.status).toBe(200);
    await expect(disconnected.json()).resolves.not.toHaveProperty("ip");
  });

  it("carries the declared client app and origin onto the request context", async () => {
    const app = createApp("10.0.0.5");

    const response = await app.request("http://rent.test/client", {
      headers: {
        origin: "http://localhost:3040",
        "x-client-app": "rentify-web/browser",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "frontend-browser",
      origin: "http://localhost:3040",
      declaredApp: "rentify-web/browser",
    });
  });
});
