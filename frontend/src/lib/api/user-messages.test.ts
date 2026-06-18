import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  ApiNetworkError,
  ApiProtocolError,
  ApiServerError,
} from "@/lib/api/types";
import {
  getApiErrorMessage,
  getSharedApiErrorMessage,
} from "@/lib/api/user-messages";

const request = {
  method: "GET",
  path: "/postings",
  requestUrl: "http://localhost:3040/api/v1/postings",
} as const;

describe("api user messages", () => {
  it("maps network failures to a connection-focused message", () => {
    const error = new ApiNetworkError("Unable to reach the server.", {
      code: "NETWORK_ERROR",
      request,
    });

    expect(
      getSharedApiErrorMessage(error, {
        action: "load your bookings",
      }),
    ).toBe(
      "We couldn't load your bookings because we couldn't reach Rentify. Check your connection and try again.",
    );
  });

  it("maps server failures to a temporary-service message", () => {
    const error = new ApiServerError("Internal server error.", {
      code: "INTERNAL_ERROR",
      request,
      status: 500,
    });

    expect(
      getSharedApiErrorMessage(error, {
        action: "create your account",
      }),
    ).toBe(
      "Rentify is having trouble right now, so we couldn't create your account. Please try again in a moment.",
    );
  });

  it("maps protocol failures to an unexpected-response message", () => {
    const error = new ApiProtocolError("Malformed response.", {
      code: "PROTOCOL_ERROR",
      request,
    });

    expect(
      getSharedApiErrorMessage(error, {
        action: "load reviews for this posting",
      }),
    ).toBe(
      "We ran into an unexpected response while trying to load reviews for this posting. Please try again in a moment.",
    );
  });

  it("preserves client-side api messages so feature code can own 4xx behavior", () => {
    const error = new ApiClientError("That invitation is no longer active.", {
      code: "INVITE_EXPIRED",
      request,
      status: 409,
    });

    expect(
      getApiErrorMessage(error, {
        action: "accept this invitation",
        fallback:
          "We couldn't accept this invitation right now. Please try again.",
      }),
    ).toBe("That invitation is no longer active.");
  });

  it("preserves useful non-api errors for local validation paths", () => {
    expect(
      getApiErrorMessage(
        new Error("Upload at least one photo before saving."),
        {
          action: "save this posting",
          fallback:
            "We couldn't save this posting right now. Please try again.",
        },
      ),
    ).toBe("Upload at least one photo before saving.");
  });
});
