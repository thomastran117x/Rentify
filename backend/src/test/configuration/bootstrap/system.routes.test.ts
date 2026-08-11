import type { Express } from "express";
import { createTestApp, type TestApp } from "../../support/fetch-app";

const mockPingDatabase = jest.fn();
const mockReadOpenApiYamlSpecFile = jest.fn();
const mockReadOpenApiJsonSpecFile = jest.fn();

jest.mock("@/configuration/resources/database", () => ({
  pingDatabase: (...args: unknown[]) => mockPingDatabase(...args),
}));

jest.mock("@/openapi/file", () => ({
  readOpenApiYamlSpecFile: (...args: unknown[]) =>
    mockReadOpenApiYamlSpecFile(...args),
  readOpenApiJsonSpecFile: (...args: unknown[]) =>
    mockReadOpenApiJsonSpecFile(...args),
}));

function createApp(register: (app: Express) => void): TestApp {
  return createTestApp((app) => {
    app.use((request, _response, next) => {
      request.requestId = "req-system-test";
      next();
    });
    register(app);
  });
}

describe("systemRouteModule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("serves API metadata at the root route", async () => {
    const { systemRouteModule } = await import(
      "@/configuration/bootstrap/routes/modules/system.routes"
    );
    const app = createApp((instance) => {
      systemRouteModule.register(instance, {} as any);
    });

    const response = await app.request("http://rent.test/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "TypeScript Express server is running",
      data: {
        apiVersion: "v1",
        apiBasePath: "/api/v1",
      },
      error: null,
      meta: {
        requestId: "req-system-test",
      },
    });
  });

  it("returns a healthy response when the database ping succeeds", async () => {
    mockPingDatabase.mockResolvedValue({
      ok: true,
      durationMs: 12,
    });
    const { systemRouteModule } = await import(
      "@/configuration/bootstrap/routes/modules/system.routes"
    );
    const app = createApp((instance) => {
      systemRouteModule.register(instance, {} as any);
    });

    const response = await app.request("http://rent.test/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Request completed successfully.",
      data: {
        ok: true,
        uptime: expect.any(Number),
        checks: {
          database: {
            ok: true,
            durationMs: 12,
          },
        },
      },
      error: null,
      meta: {
        requestId: "req-system-test",
      },
    });
  });

  it("returns a service unavailable response when the database ping fails", async () => {
    mockPingDatabase.mockRejectedValueOnce(new Error("database down"));
    const { systemRouteModule } = await import(
      "@/configuration/bootstrap/routes/modules/system.routes"
    );
    const app = createApp((instance) => {
      systemRouteModule.register(instance, {} as any);
    });

    const response = await app.request("http://rent.test/health");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Health check failed.",
      data: null,
      error: {
        code: "SERVICE_UNAVAILABLE",
        details: {
          uptime: expect.any(Number),
          checks: {
            database: {
              ok: false,
              message: "database down",
            },
          },
        },
      },
      meta: {
        requestId: "req-system-test",
      },
    });
  });

  it("streams the canonical OpenAPI document", async () => {
    mockReadOpenApiYamlSpecFile.mockResolvedValueOnce("openapi: 3.1.0\n");
    const { systemRouteModule } = await import(
      "@/configuration/bootstrap/routes/modules/system.routes"
    );
    const app = createApp((instance) => {
      systemRouteModule.register(instance, {} as any);
    });

    const response = await app.request("http://rent.test/openapi.yaml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/yaml; charset=UTF-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("openapi: 3.1.0\n");
  });

  it("streams the canonical OpenAPI JSON document", async () => {
    mockReadOpenApiJsonSpecFile.mockResolvedValueOnce('{"openapi":"3.1.0"}\n');
    const { systemRouteModule } = await import(
      "@/configuration/bootstrap/routes/modules/system.routes"
    );
    const app = createApp((instance) => {
      systemRouteModule.register(instance, {} as any);
    });

    const response = await app.request("http://rent.test/openapi.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe('{"openapi":"3.1.0"}\n');
  });
});
