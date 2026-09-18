import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  ApiProtocolError,
  ApiRateLimitError,
  ApiServerError,
} from "@/lib/api/types";
import { readJson, toApiError, unwrapApiResponse } from "./response";

describe("api response helpers", () => {
  it.each([500, 502, 503, 504])(
    "preserves the body request ID for %i failures",
    (status) => {
      const error = toApiError(
        new Response(null, {
          status,
          headers: { "x-request-id": "header-id" },
        }),
        {
          success: false,
          message: "Service unavailable.",
          error: { code: "SERVER_ERROR" },
          meta: { requestId: " body-id " },
        },
      );

      expect(error).toBeInstanceOf(ApiServerError);
      expect(error.requestId).toBe("body-id");
      expect(error.message).toBe("Service unavailable. Request ID: body-id");
    },
  );

  it.each([
    undefined,
    null,
    42,
    "",
    " ",
    "bad id",
    "<script>",
    "a".repeat(129),
  ])(
    "falls back to the header when the body request ID is invalid: %s",
    (requestId) => {
      const error = toApiError(
        new Response(null, {
          status: 503,
          headers: { "x-request-id": "header-id" },
        }),
        {
          message: "Unavailable.",
          error: { code: "SERVER_ERROR" },
          meta: { requestId },
        },
      );
      expect(error.requestId).toBe("header-id");
      expect(error.message).toBe("Unavailable. Request ID: header-id");
    },
  );

  it.each([undefined, "bad id"])(
    "omits missing or invalid references: %s",
    (requestId) => {
      const error = toApiError(new Response(null, { status: 500 }), {
        message: "Internal server error.",
        error: { code: "SERVER_ERROR" },
        meta: { requestId },
      });
      expect(error.requestId).toBeUndefined();
      expect(error.message).toBe("Internal server error.");
    },
  );

  it("uses the header for an invalid error envelope", () => {
    const error = toApiError(
      new Response(null, {
        status: 502,
        headers: { "x-request-id": "gateway-id" },
      }),
      null,
    );
    expect(error.requestId).toBe("gateway-id");
    expect(error.message).toBe(
      "The server returned an invalid error response. Request ID: gateway-id",
    );
  });

  it.each([400, 422, 429])(
    "does not display references for %i failures",
    (status) => {
      const error = toApiError(new Response(null, { status }), {
        message: "Try again.",
        error: { code: "CLIENT_ERROR" },
        meta: { requestId: "client-id" },
      });
      expect(error.requestId).toBe("client-id");
      expect(error.message).toBe("Try again.");
    },
  );

  it("reads JSON responses and ignores non-JSON payloads", async () => {
    const jsonResponse = new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
      },
    });
    const textResponse = new Response("plain text", {
      headers: {
        "content-type": "text/plain",
      },
    });

    await expect(readJson(jsonResponse)).resolves.toEqual({ ok: true });
    await expect(readJson(textResponse)).resolves.toBeNull();
  });

  it("unwraps API response envelopes", () => {
    expect(
      unwrapApiResponse({
        success: true,
        message: "ok",
        data: {
          id: "value-1",
        },
        error: null,
        meta: {
          requestId: "request-1",
        },
      }),
    ).toEqual({
      id: "value-1",
    });
  });

  it("throws when an API envelope is missing its data payload", () => {
    expect(() => unwrapApiResponse(null)).toThrow(ApiProtocolError);
    expect(() => unwrapApiResponse(null)).toThrow(
      "API response payload did not include a valid data envelope.",
    );
  });

  it("creates ApiClientError instances from failure payloads", () => {
    const response = new Response(null, {
      status: 422,
    });

    const error = toApiError(response, {
      message: "Validation failed.",
      error: {
        code: "VALIDATION_ERROR",
        details: {
          email: "invalid",
        },
      },
    });

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.message).toBe("Validation failed.");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(422);
    expect(error.details).toEqual({
      email: "invalid",
    });
  });

  it("creates ApiRateLimitError instances from 429 payloads", () => {
    const response = new Response(null, {
      status: 429,
    });

    const error = toApiError(response, {
      message: "Too many requests.",
      error: {
        code: "RATE_LIMITED",
        details: {
          retryAfterSeconds: 30,
        },
      },
    });

    expect(error).toBeInstanceOf(ApiRateLimitError);
    expect(error.message).toBe("Too many requests.");
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.status).toBe(429);
  });
});
