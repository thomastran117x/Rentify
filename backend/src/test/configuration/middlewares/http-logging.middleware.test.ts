import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { loggerFactory } from "@/configuration/logging";
import { httpLoggingMiddleware } from "@/configuration/middlewares/http-logging.middleware";

function createApp() {
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    context.set("client", {
      ip: "203.0.113.10",
      device: {
        type: "desktop",
        isMobile: false,
      },
    });
    context.set("outputFormat", "json");
    context.set("requestId", "request-123");
    context.set(
      "logger",
      loggerFactory
        .forComponent("http-logging.middleware.test", "middleware")
        .child({
          requestId: "request-123",
        }),
    );
    await next();
  });
  app.use("*", httpLoggingMiddleware);
  app.get("/oauth/callback", (context) => context.json({ ok: true }));

  return app;
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
});
