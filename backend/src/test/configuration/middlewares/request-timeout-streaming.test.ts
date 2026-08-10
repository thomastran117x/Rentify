import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requestTimeoutMiddleware } from "@/configuration/middlewares/request-timeout.middleware";

/**
 * Guards the invariant the booking message SSE endpoint depends on.
 *
 * `requestTimeoutMiddleware` races `next()` against a timer, but `streamSSE`
 * returns its Response synchronously, so `next()` resolves immediately and the
 * timer is cleared. A long-lived stream therefore survives a short request
 * timeout. If a future refactor makes the middleware await the response body,
 * every stream would be cut at the timeout instead — this test fails first.
 */
describe("requestTimeoutMiddleware with streaming responses", () => {
  const originalTimeout = process.env.REQUEST_TIMEOUT_MS;

  beforeAll(() => {
    process.env.REQUEST_TIMEOUT_MS = "100";
  });

  afterAll(() => {
    if (originalTimeout === undefined) {
      delete process.env.REQUEST_TIMEOUT_MS;
    } else {
      process.env.REQUEST_TIMEOUT_MS = originalTimeout;
    }
  });

  it("does not time out a stream that writes after the timeout window", async () => {
    const app = new Hono();
    app.use("*", requestTimeoutMiddleware);
    app.get("/stream", (context) =>
      streamSSE(context, async (stream) => {
        await stream.writeSSE({ event: "ready", data: "ok" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await stream.writeSSE({ event: "late", data: "still-open" });
      }),
    );

    const response = await app.request("http://rent.test/stream");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";

    while (!received.includes("event: late")) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      received += decoder.decode(chunk.value, { stream: true });
    }

    expect(received).toContain("event: ready");
    // The frame written 300ms in — well past the 100ms request timeout.
    expect(received).toContain("event: late");

    await reader.cancel();
  }, 10_000);

  it("still times out a non-streaming handler", async () => {
    const app = new Hono();
    let captured: unknown;

    app.use("*", requestTimeoutMiddleware);
    app.get("/slow", async (context) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return context.json({ ok: true });
    });
    app.onError((error, context) => {
      captured = error;
      return context.json({ ok: false }, 504);
    });

    const response = await app.request("http://rent.test/slow");

    expect(response.status).toBe(504);
    expect(captured).toMatchObject({ status: 504, message: "Request timed out." });
  }, 10_000);
});
