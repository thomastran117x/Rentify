import { describe, expect, it } from "vitest";
import { readAccessTokenTiming } from "./access-token";

function encodeBase64Url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function createToken(claims: object): string {
  return `${encodeBase64Url({ alg: "HS256", typ: "JWT" })}.${encodeBase64Url(claims)}.signature`;
}

describe("access token timing", () => {
  it("schedules a standard token 60 seconds before expiration", () => {
    expect(
      readAccessTokenTiming(createToken({ iat: 1_000, exp: 1_900 })),
    ).toEqual({
      issuedAtMs: 1_000_000,
      expiresAtMs: 1_900_000,
      refreshAtMs: 1_840_000,
    });
  });

  it("uses ten percent of unusually short token lifetimes", () => {
    expect(
      readAccessTokenTiming(createToken({ iat: 1_000, exp: 1_030 })),
    ).toEqual({
      issuedAtMs: 1_000_000,
      expiresAtMs: 1_030_000,
      refreshAtMs: 1_027_000,
    });
  });

  it.each([
    "not-a-jwt",
    "header.invalid-payload.signature",
    createToken({ exp: 1_900 }),
    createToken({ iat: 1_000, exp: 1_000 }),
    createToken({ iat: "1000", exp: 1_900 }),
    createToken({ iat: 1_000, exp: Number.MAX_VALUE }),
  ])("rejects malformed or incomplete timing claims", (token) => {
    expect(readAccessTokenTiming(token)).toBeNull();
  });
});
