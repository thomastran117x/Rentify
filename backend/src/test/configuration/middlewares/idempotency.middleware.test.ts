import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { idempotencyMiddleware } from "@/configuration/middlewares/idempotency.middleware";
import { requestIdMiddleware } from "@/configuration/middlewares/request-id.middleware";
import { createTestApp } from "../../support/fetch-app";

function createApp() {
  return createTestApp((app) => {
    app.use(requestIdMiddleware);
    app.use(idempotencyMiddleware);
    app.post("/payments", (request, response) => {
      response.json({
        idempotencyKey: request.idempotencyKey,
        requestId: request.requestId,
      });
    });
    app.use(handleApplicationError);
  });
}

describe("idempotencyMiddleware", () => {
  it("prefers the explicit idempotency key header", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/payments", {
      method: "POST",
      headers: {
        "idempotency-key": "payment-attempt-1",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-key")).toBe("payment-attempt-1");
    await expect(response.json()).resolves.toEqual({
      idempotencyKey: "payment-attempt-1",
      requestId: expect.any(String),
    });
  });

  it("falls back to the request id when no explicit idempotency key is supplied", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/payments", {
      method: "POST",
      headers: {
        "x-request-id": "req-fallback-1",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-key")).toBe("req-fallback-1");
    await expect(response.json()).resolves.toEqual({
      idempotencyKey: "req-fallback-1",
      requestId: "req-fallback-1",
    });
  });

  it("rejects conflicting idempotency key headers", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/payments", {
      method: "POST",
      headers: {
        "idempotency-key": "payment-attempt-1",
        "x-idempotency-key": "payment-attempt-2",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Conflicting idempotency key headers were provided.",
      data: null,
      error: {
        code: "BAD_REQUEST",
        details: {
          headers: ["idempotency-key", "x-idempotency-key"],
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });
});
