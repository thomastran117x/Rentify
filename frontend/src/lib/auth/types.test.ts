import { describe, expect, it } from "vitest";
import { ApiClientError, ApiServerError, readLoginMfaChallenge } from "./types";

const challenge = {
  mfaRequired: true,
  mfaChallengeToken: "challenge-token",
  availableFactors: ["totp"],
  expiresInSeconds: 300,
};

function clientError(status: number, details: unknown) {
  return new ApiClientError("Authenticator code is required.", {
    code: "UNAUTHORIZED",
    status,
    details,
    request: {
      method: "POST",
      path: "/auth/local/login",
      requestUrl: "http://localhost:8040/api/v1/auth/local/login",
    },
  });
}

describe("readLoginMfaChallenge", () => {
  it("reads the challenge from a 401 that needs an authenticator code", () => {
    expect(readLoginMfaChallenge(clientError(401, challenge))).toEqual(
      challenge,
    );
  });

  it.each([
    ["a wrong password", clientError(401, undefined)],
    ["a refusal without a challenge", clientError(401, { mfaRequired: true })],
    [
      "an empty token",
      clientError(401, { ...challenge, mfaChallengeToken: "" }),
    ],
    [
      "factors that are not a list",
      clientError(401, { ...challenge, availableFactors: "totp" }),
    ],
    [
      "a missing lifetime",
      clientError(401, { ...challenge, expiresInSeconds: undefined }),
    ],
    ["another status", clientError(400, challenge)],
    [
      "a server error",
      new ApiServerError("Down", {
        code: "INTERNAL",
        status: 500,
        request: {
          method: "POST",
          path: "/auth/local/login",
          requestUrl: "http://localhost:8040/api/v1/auth/local/login",
        },
      }),
    ],
    ["a plain error", new Error("boom")],
  ])("ignores %s", (_case, error) => {
    expect(readLoginMfaChallenge(error)).toBeNull();
  });
});
