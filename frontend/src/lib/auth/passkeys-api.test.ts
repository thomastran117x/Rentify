import { beforeEach, describe, expect, it, vi } from "vitest";
import { passkeysApi, suggestPasskeyName } from "./passkeys-api";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/lib/auth/api", () => ({
  getAuthenticatedJson: (path: string) => requestMock("GET", path),
  postAuthenticatedJson: (path: string, body: unknown) =>
    requestMock("POST", path, body),
  patchAuthenticatedJson: (path: string, body: unknown) =>
    requestMock("PATCH", path, body),
  deleteAuthenticatedJson: (path: string) => requestMock("DELETE", path),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJsonOnce: (method: string, path: string, body?: unknown) =>
    requestMock(`${method} once`, path, body),
}));

describe("passkeysApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the passkey endpoints, sending an attestation only once", () => {
    const credential = { id: "attestation" } as never;

    passkeysApi.list();
    passkeysApi.getRegistrationOptions();
    passkeysApi.verifyRegistration(credential, "Laptop");
    passkeysApi.rename("passkey/1", "Desk key");
    passkeysApi.remove("passkey/1");

    expect(requestMock.mock.calls).toEqual([
      ["GET", "/auth/mfa/passkeys"],
      ["POST", "/auth/mfa/passkeys/register/options", {}],
      [
        "POST once",
        "/auth/mfa/passkeys/register/verify",
        { credential, name: "Laptop" },
      ],
      ["PATCH", "/auth/mfa/passkeys/passkey%2F1", { name: "Desk key" }],
      ["DELETE", "/auth/mfa/passkeys/passkey%2F1"],
    ]);
  });
});

describe("suggestPasskeyName", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Safari on macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox on Linux",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    ["SomeBot/1.0 (Windows)", "Windows"],
    ["SomeBrowser Firefox/1.0", "Firefox"],
    ["curl/8.0", "Passkey"],
  ])("names %s", (userAgent, name) => {
    expect(suggestPasskeyName(userAgent)).toBe(name);
  });
});
