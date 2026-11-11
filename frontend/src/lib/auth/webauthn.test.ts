import { beforeEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => {
  class WebAuthnError extends Error {
    code: string;

    constructor({
      message,
      code,
      name,
    }: {
      message: string;
      code: string;
      name?: string;
    }) {
      super(message);
      this.code = code;
      this.name = name ?? "WebAuthnError";
    }
  }

  return {
    WebAuthnError,
    browserSupportsWebAuthn: vi.fn(() => true),
    startAuthentication: vi.fn(),
    startRegistration: vi.fn(),
  };
});

vi.mock("@simplewebauthn/browser", () => browser);

import {
  createPasskey,
  getPasskeyAssertion,
  PasskeyCeremonyError,
  supportsPasskeys,
} from "./webauthn";

const REQUEST_OPTIONS = { challenge: "c", rpId: "localhost" } as never;
const CREATION_OPTIONS = { challenge: "c" } as never;

function domError(name: string) {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("webauthn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browser.browserSupportsWebAuthn.mockReturnValue(true);
  });

  it("reports support from the browser library, and none when it throws", () => {
    expect(supportsPasskeys()).toBe(true);

    browser.browserSupportsWebAuthn.mockImplementation(() => {
      throw new Error("no window");
    });
    expect(supportsPasskeys()).toBe(false);
  });

  it("returns the credential a completed prompt gives", async () => {
    browser.startAuthentication.mockResolvedValue({ id: "assertion" });
    browser.startRegistration.mockResolvedValue({ id: "attestation" });

    await expect(getPasskeyAssertion(REQUEST_OPTIONS)).resolves.toEqual({
      status: "completed",
      credential: { id: "assertion" },
    });
    await expect(createPasskey(CREATION_OPTIONS)).resolves.toEqual({
      status: "completed",
      credential: { id: "attestation" },
    });
    expect(browser.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: REQUEST_OPTIONS,
    });
    expect(browser.startRegistration).toHaveBeenCalledWith({
      optionsJSON: CREATION_OPTIONS,
    });
  });

  it.each([
    ["a closed or timed-out prompt", domError("NotAllowedError")],
    ["an aborted prompt", domError("AbortError")],
    [
      "an aborted ceremony",
      new browser.WebAuthnError({
        message: "aborted",
        code: "ERROR_CEREMONY_ABORTED",
      }),
    ],
  ])("treats %s as cancelled", async (_label, error) => {
    browser.startAuthentication.mockRejectedValue(error);

    await expect(getPasskeyAssertion(REQUEST_OPTIONS)).resolves.toEqual({
      status: "cancelled",
    });
  });

  it.each([
    [
      "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      "This passkey is already on your account.",
    ],
    ["ERROR_INVALID_RP_ID", "Passkeys can't be used from this address."],
    ["ERROR_INVALID_DOMAIN", "Passkeys can't be used from this address."],
    [
      "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      "Your browser couldn't use a passkey just now.",
    ],
  ])("explains %s", async (code, message) => {
    browser.startRegistration.mockRejectedValue(
      new browser.WebAuthnError({ message: code, code }),
    );

    const failure = createPasskey(CREATION_OPTIONS);

    await expect(failure).rejects.toBeInstanceOf(PasskeyCeremonyError);
    await expect(failure).rejects.toThrow(message);
  });

  it("refuses up front on a browser without WebAuthn", async () => {
    browser.browserSupportsWebAuthn.mockReturnValue(false);

    await expect(getPasskeyAssertion(REQUEST_OPTIONS)).rejects.toThrow(
      "This browser can't use passkeys.",
    );
    expect(browser.startAuthentication).not.toHaveBeenCalled();
  });
});
