import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { requestIdMiddleware } from "@/configuration/middlewares/request-id.middleware";
import { requestTimeoutMiddleware } from "@/configuration/middlewares/request-timeout.middleware";
import { createTestApp } from "../../support/fetch-app";

function createApp() {
  return createTestApp((app) => {
    app.use(requestIdMiddleware);
    app.use(requestTimeoutMiddleware);
    app.get("/slow", async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 25));

      // The timeout middleware has already answered by the time a slow handler
      // finishes; writing again would throw.
      if (!response.headersSent) {
        response.json({ ok: true });
      }
    });
    app.get("/fast", (_request, response) => {
      response.json({ ok: true });
    });
    app.use(handleApplicationError);
  });
}

describe("requestTimeoutMiddleware", () => {
  const originalTimeout = process.env.REQUEST_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.REQUEST_TIMEOUT_MS;
  });

  afterAll(() => {
    if (originalTimeout === undefined) {
      delete process.env.REQUEST_TIMEOUT_MS;
      return;
    }

    process.env.REQUEST_TIMEOUT_MS = originalTimeout;
  });

  it("returns a gateway timeout when a request exceeds the configured budget", async () => {
    process.env.REQUEST_TIMEOUT_MS = "10";
    const app = createApp();
    const response = await app.request("http://rent.test/slow");

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request timed out.",
      data: null,
      error: {
        code: "GATEWAY_TIMEOUT",
        details: {
          requestId: expect.any(String),
          timeoutMs: 10,
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });

  it("allows fast requests to complete normally", async () => {
    process.env.REQUEST_TIMEOUT_MS = "100";
    const app = createApp();
    const response = await app.request("http://rent.test/fast");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("uses default timeout when REQUEST_TIMEOUT_MS is not set", async () => {
    // REQUEST_TIMEOUT_MS is deleted in beforeEach — default (15 000 ms) applies.
    const app = createApp();
    const response = await app.request("http://rent.test/fast");

    expect(response.status).toBe(200);
  });

  it("falls back to default timeout when REQUEST_TIMEOUT_MS is not a valid integer", async () => {
    process.env.REQUEST_TIMEOUT_MS = "not-a-number";
    const app = createApp();
    const response = await app.request("http://rent.test/fast");

    expect(response.status).toBe(200);
  });
});
