import { describe, expect, it } from "vitest";
import { ApiClientError, ApiProtocolError } from "@/lib/api/types";
import { readJson, toApiError, unwrapApiResponse } from "./response";

describe("api response helpers", () => {
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
});
