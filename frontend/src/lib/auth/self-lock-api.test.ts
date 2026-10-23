import { beforeEach, describe, expect, it, vi } from "vitest";
import { selfLockApi } from "./self-lock-api";

const { publicJsonMock, authenticatedMock, cancelRefreshMock } = vi.hoisted(
  () => ({
    publicJsonMock: vi.fn(),
    authenticatedMock: vi.fn(),
    cancelRefreshMock: vi.fn(),
  }),
);

vi.mock("@/lib/api/client", () => ({
  publicJson: publicJsonMock,
  cancelStoredSessionRefresh: cancelRefreshMock,
}));

vi.mock("@/lib/auth/api", () => ({
  postAuthenticatedJson: (path: string, body: unknown) =>
    authenticatedMock("POST", path, body),
}));

describe("Self-lock API client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the emailed token to the public endpoint", () => {
    selfLockApi.lockWithToken("token-1");

    expect(publicJsonMock).toHaveBeenCalledWith(
      "POST",
      "/auth/account/self-lock",
      { token: "token-1" },
    );
    expect(authenticatedMock).not.toHaveBeenCalled();
  });

  it("locks the signed-in account, stopping any refresh first", () => {
    selfLockApi.lockCurrentSession();

    expect(cancelRefreshMock).toHaveBeenCalled();
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/account/self-lock/session",
      {},
    );
  });
});
