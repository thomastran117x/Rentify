import type { ClientSource } from "@/configuration/http/client-source";
import { loggerFactory } from "@/configuration/logging";
import { httpLoggingMiddleware } from "@/configuration/middlewares/http-logging.middleware";
import { createTestApp } from "../../support/fetch-app";

function createApp(source: ClientSource = "api-tool") {
  return createTestApp((app) => {
    app.use((request, _response, next) => {
      request.client = {
        ip: "203.0.113.10",
        source,
        device: {
          type: "desktop",
          isMobile: false,
        },
      };
      request.outputFormat = "json";
      request.requestId = "request-123";
      request.logger = loggerFactory
        .forComponent("http-logging.middleware.test", "middleware")
        .child({
          requestId: "request-123",
        });
      next();
    });
    app.use(httpLoggingMiddleware);
    app.get("/oauth/callback", (_request, response) => {
      response.json({ ok: true });
    });
  });
}

describe("httpLoggingMiddleware", () => {
  const originalLogSilent = process.env.LOG_SILENT;

  beforeEach(() => {
    process.env.LOG_SILENT = "false";
  });

  afterEach(() => {
    process.env.LOG_SILENT = originalLogSilent;
    jest.restoreAllMocks();
  });

  function spyStdout() {
    return jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as any);
  }

  it("keeps safe query params in the log output", async () => {
    const app = createApp();
    const writeSpy = spyStdout();

    const response = await app.request(
      "http://rent.test/oauth/callback?page=2&pageSize=10&format=json",
    );

    expect(response.status).toBe(200);
    expect(writeSpy).toHaveBeenCalled();

    const output = writeSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("/oauth/callback?page=2&pageSize=10&format=json");
  });

  it("redacts sensitive query params before logging the URL", async () => {
    const app = createApp();
    const writeSpy = spyStdout();

    const response = await app.request(
      "http://rent.test/oauth/callback?code=oauth-code&state=csrf-state&token=bearer-token&page=2",
    );

    expect(response.status).toBe(200);
    expect(writeSpy).toHaveBeenCalled();

    const output = writeSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("/oauth/callback?");
    expect(output).toContain("page=2");
    expect(output).toContain("code=%5BREDACTED%5D");
    expect(output).toContain("state=%5BREDACTED%5D");
    expect(output).toContain("token=%5BREDACTED%5D");
    expect(output).not.toContain("oauth-code");
    expect(output).not.toContain("csrf-state");
    expect(output).not.toContain("bearer-token");
  });

  it("labels the log line and structured fields with the caller type", async () => {
    const app = createApp("frontend-browser");
    const writeSpy = spyStdout();

    const response = await app.request("http://rent.test/oauth/callback");

    expect(response.status).toBe(200);

    const output = writeSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("src=frontend-browser");
    expect(output).toContain("clientSource=frontend-browser");
  });

  it("reports an unknown caller type when client context is missing", async () => {
    const app = createTestApp((instance) => {
      instance.use((request, _response, next) => {
        request.outputFormat = "json";
        request.requestId = "request-456";
        request.logger = loggerFactory
          .forComponent("http-logging.middleware.test", "middleware")
          .child({ requestId: "request-456" });
        next();
      });
      instance.use(httpLoggingMiddleware);
      instance.get("/oauth/callback", (_request, response) => {
        response.json({ ok: true });
      });
    });
    const writeSpy = spyStdout();

    const response = await app.request("http://rent.test/oauth/callback");

    expect(response.status).toBe(200);

    const output = writeSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("src=unknown");
    expect(output).toContain("ip=unknown");
  });
});
