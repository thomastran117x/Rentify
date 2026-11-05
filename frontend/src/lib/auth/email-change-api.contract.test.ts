import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailChangeApi } from "./email-change-api";

const { authenticatedMock, publicJsonMock } = vi.hoisted(() => ({
  authenticatedMock: vi.fn(),
  publicJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  publicJson: publicJsonMock,
}));

vi.mock("@/lib/auth/api", () => ({
  getAuthenticatedJson: (path: string) => authenticatedMock("GET", path),
  postAuthenticatedJson: (path: string, body: unknown) =>
    authenticatedMock("POST", path, body),
  deleteAuthenticatedJson: (path: string) => authenticatedMock("DELETE", path),
}));

describe("Email change API client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the new address to the change endpoint", () => {
    emailChangeApi.request("owner-one-new@rentify.local");

    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/email/change",
      { email: "owner-one-new@rentify.local" },
    );
  });

  it("posts an empty body to resend, which reads the pending address server-side", () => {
    emailChangeApi.resend();

    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/email/change/resend",
      {},
    );
  });

  it("posts the emailed token to the public revert endpoint, without a session", () => {
    emailChangeApi.revertWithToken("revert-token");

    expect(publicJsonMock).toHaveBeenCalledWith(
      "POST",
      "/auth/email/change/revert",
      { token: "revert-token" },
    );
    expect(authenticatedMock).not.toHaveBeenCalled();
  });

  it("posts only the code to confirm", () => {
    emailChangeApi.confirm("123456");

    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/email/change/confirm",
      { code: "123456" },
    );
  });

  it("reads and cancels the pending change on the same path", () => {
    emailChangeApi.pending();
    emailChangeApi.cancel();

    expect(authenticatedMock).toHaveBeenCalledWith("GET", "/auth/email/change");
    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/auth/email/change",
    );
  });

  it("reads the dev code preview from its own path", () => {
    emailChangeApi.previewCode();

    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/auth/email/change/dev/otp",
    );
  });
});
