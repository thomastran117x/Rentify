import { beforeEach, describe, expect, it, vi } from "vitest";
import { mfaTotpApi } from "./mfa-totp-api";
import { mfaVerificationApi } from "./mfa-verification-api";

const { authenticatedMock, buildPathMock } = vi.hoisted(() => ({
  authenticatedMock: vi.fn(),
  buildPathMock: vi.fn(
    (path: string, query: Record<string, string>) =>
      `${path}?${new URLSearchParams(query).toString()}`,
  ),
}));

vi.mock("@/lib/auth/api", () => ({
  getAuthenticatedJson: (path: string) => authenticatedMock("GET", path),
  postAuthenticatedJson: (path: string, body: unknown) =>
    authenticatedMock("POST", path, body),
  deleteAuthenticatedJson: (path: string) => authenticatedMock("DELETE", path),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: (method: string, path: string, body?: unknown) =>
    authenticatedMock(method, path, body),
  buildPathWithQuery: buildPathMock,
}));

describe("MFA API clients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses authenticated endpoints for the TOTP enrollment lifecycle", () => {
    mfaTotpApi.getStatus();
    mfaTotpApi.beginEnrollment();
    mfaTotpApi.beginEnrollment("person@example.com");
    mfaTotpApi.confirmEnrollment("123456");
    mfaTotpApi.disable();
    mfaTotpApi.cancelEnrollment();

    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/auth/mfa/totp/status",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/mfa/totp/begin",
      { accountName: "person@example.com" },
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/mfa/totp/confirm",
      { code: "123456" },
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/auth/mfa/totp/pending",
    );
  });

  it("uses scopes, factors, and codes for verification endpoints", () => {
    mfaVerificationApi.getOptions("mfa-management");
    mfaVerificationApi.issueChallenge("device-login", "sms");
    mfaVerificationApi.confirmChallenge("mfa-management", "totp", "123456");
    mfaVerificationApi.previewEmailOtp("device-login");

    expect(buildPathMock).toHaveBeenCalledWith("/auth/mfa/verify/options", {
      scope: "mfa-management",
    });
    expect(buildPathMock).toHaveBeenCalledWith("/auth/mfa/verify/dev/otp", {
      scope: "device-login",
    });
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/mfa/verify/challenge",
      { scope: "device-login", factor: "sms" },
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/mfa/verify/confirm",
      { scope: "mfa-management", factor: "totp", code: "123456" },
    );
  });
});
