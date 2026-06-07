import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";

jest.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: jest.fn(),
}));

jest.mock("@/configuration/environment", () => ({
  getOptionalEnvironmentVariable: jest.fn(),
}));

const mockGetConnInfo = getConnInfo as jest.MockedFunction<typeof getConnInfo>;
const mockGetOptionalEnvironmentVariable =
  getOptionalEnvironmentVariable as jest.MockedFunction<
    typeof getOptionalEnvironmentVariable
  >;

function createApp() {
  const app = new Hono<AppBindings>();
  app.use("*", clientContextMiddleware);
  app.get("/client", (context) => context.json(context.get("client")));
  return app;
}

describe("clientContextMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOptionalEnvironmentVariable.mockReturnValue(undefined);
    mockGetConnInfo.mockReturnValue({
      remote: {
        address: "10.0.0.5",
      },
    } as ReturnType<typeof getConnInfo>);
  });

  it("uses the remote socket address when proxy headers are not trusted", async () => {
    const app = createApp();

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
    const app = createApp();

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
        id: undefined,
        type: "bot",
        isMobile: false,
        userAgent: "curl/8.0.1",
        platform: undefined,
      },
    });
  });

  it("falls back to alternate proxy headers and tolerates missing connection info", async () => {
    mockGetOptionalEnvironmentVariable.mockReturnValue("1");
    mockGetConnInfo.mockImplementation(() => {
      throw new Error("conn info unavailable");
    });
    const app = createApp();

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
        id: undefined,
        type: "tablet",
        isMobile: false,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "Linux",
      },
    });
  });
});
