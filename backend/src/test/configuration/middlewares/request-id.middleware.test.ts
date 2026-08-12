import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { requestIdMiddleware } from "@/configuration/middlewares/request-id.middleware";
import { createTestApp } from "../../support/fetch-app";

function createApp() {
  return createTestApp((app) => {
    app.use(requestIdMiddleware);
    app.get("/health", (request, response) => {
      response.json({
        requestId: request.requestId,
      });
    });
    app.use(handleApplicationError);
  });
}

describe("requestIdMiddleware", () => {
  it("reuses a valid incoming request id and echoes it in the response", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/health", {
      headers: {
        "x-request-id": "req-1234",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-1234");
    await expect(response.json()).resolves.toEqual({
      requestId: "req-1234",
    });
  });

  it("generates a request id when the client does not provide one", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("rejects malformed request id headers", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/health", {
      headers: {
        "x-request-id": "bad request id",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "x-request-id header is invalid.",
      data: null,
      error: {
        code: "BAD_REQUEST",
        details: {
          header: "x-request-id",
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });
});
