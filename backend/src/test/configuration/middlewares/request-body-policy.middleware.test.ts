import express from "express";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import {
  readDeclaredContentLength,
  readRequestBodyMaxBytes,
  requestBodyPolicyMiddleware,
} from "@/configuration/middlewares/request-body-policy.middleware";
import { readRawBody } from "@/configuration/http/request";
import { createTestApp } from "../../support/fetch-app";

/**
 * Composed the same way as createApplication: the policy middleware gates the
 * request, then the body parsers run with the matching limit and media types.
 */
function createApp() {
  return createTestApp((app) => {
    app.use(requestBodyPolicyMiddleware);

    const limit = readRequestBodyMaxBytes();
    app.use("/blob/upload", express.raw({ type: "*/*", limit }));
    app.use(
      express.json({
        limit,
        type: ["application/json", "application/*+json"],
        verify: (request, _response, buffer) => {
          (request as express.Request).rawBody = buffer;
        },
      }),
    );

    app.get("/profiles", (_request, response) => {
      response.json({ ok: true });
    });
    app.post("/profiles", (request, response) => {
      response.json(request.body);
    });
    app.post("/blob/upload", (request, response) => {
      response.json({ body: readRawBody(request) });
    });
    app.post("/payments/webhooks/square", (request, response) => {
      response.json({ body: readRawBody(request) });
    });

    app.use(handleApplicationError);
  });
}

describe("requestBodyPolicyMiddleware", () => {
  const originalMaxBytes = process.env.REQUEST_BODY_MAX_BYTES;

  beforeEach(() => {
    delete process.env.REQUEST_BODY_MAX_BYTES;
  });

  afterAll(() => {
    if (originalMaxBytes === undefined) {
      delete process.env.REQUEST_BODY_MAX_BYTES;
      return;
    }

    process.env.REQUEST_BODY_MAX_BYTES = originalMaxBytes;
  });

  it("rejects non-json request bodies on write endpoints", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
      },
      body: "hello",
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request body must use application/json.",
      data: null,
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("rejects oversized request bodies before they reach the route handler", async () => {
    process.env.REQUEST_BODY_MAX_BYTES = "12";
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bio: "This body is definitely larger than twelve bytes.",
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request body is too large.",
      data: null,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        details: {
          limitBytes: 12,
          receivedBytes: expect.any(Number),
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("allows raw webhook routes to keep reading their json payload as text", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/payments/webhooks/square",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventId: "evt_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: '{"eventId":"evt_123"}',
    });
  });

  it("allows non-json uploads on blob routes", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/blob/upload", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
      },
      body: "raw blob body",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: "raw blob body",
    });
  });

  it("allows custom json media types on write endpoints", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/merge-patch+json",
      },
      body: JSON.stringify({
        bio: "patched",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bio: "patched",
    });
  });

  it("skips body enforcement for read-only requests", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "GET",
      headers: {
        "content-type": "text/plain",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  // Asserted directly rather than over HTTP: the test client talks to a real
  // socket, which will not emit a malformed Content-Length.
  describe("readDeclaredContentLength", () => {
    function requestWithContentLength(value?: string) {
      const headers: Record<string, string> = {};

      if (value !== undefined) {
        headers["content-length"] = value;
      }

      return {
        headers,
        get: (name: string) => headers[name.toLowerCase()],
      } as unknown as express.Request;
    }

    it("rejects a non-numeric content length", () => {
      expect(() =>
        readDeclaredContentLength(requestWithContentLength("abc")),
      ).toThrow("Content-Length header is invalid.");
    });

    it("rejects a negative content length", () => {
      expect(() =>
        readDeclaredContentLength(requestWithContentLength("-1")),
      ).toThrow("Content-Length header is invalid.");
    });

    it("returns null when the header is absent", () => {
      expect(readDeclaredContentLength(requestWithContentLength())).toBeNull();
    });

    it("returns the parsed length when the header is valid", () => {
      expect(readDeclaredContentLength(requestWithContentLength("42"))).toBe(
        42,
      );
    });
  });
});
