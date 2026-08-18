import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authApi,
  deleteAuthenticatedJson,
  getAuthenticatedJson,
  getOptionalAuthJson,
  patchAuthenticatedJson,
  postAuthenticatedJson,
  putAuthenticatedJson,
} from "./api";

const {
  authenticatedMock,
  optionalMock,
  publicMock,
  refreshMock,
  hintMock,
  deviceMock,
  tokenListMock,
  tokenCreateMock,
  tokenRevokeMock,
} = vi.hoisted(() => ({
  authenticatedMock: vi.fn(),
  optionalMock: vi.fn(),
  publicMock: vi.fn(),
  refreshMock: vi.fn(),
  hintMock: vi.fn(),
  deviceMock: vi.fn(() => "device-1"),
  tokenListMock: vi.fn(),
  tokenCreateMock: vi.fn(),
  tokenRevokeMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedMock,
  optionalAuthJson: optionalMock,
  publicJson: publicMock,
  refreshStoredSession: refreshMock,
  hasRefreshCookieHint: hintMock,
}));
vi.mock("@/lib/auth/device", () => ({ getDeviceId: deviceMock }));
vi.mock("@/lib/personal-access-tokens/api", () => ({
  personalAccessTokensApi: {
    list: tokenListMock,
    create: tokenCreateMock,
    revoke: tokenRevokeMock,
  },
}));

describe("auth API request contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates generic authenticated helpers", () => {
    postAuthenticatedJson("/post", { value: 1 });
    getAuthenticatedJson("/get");
    patchAuthenticatedJson("/patch", { value: 2 });
    putAuthenticatedJson("/put", { value: 3 });
    deleteAuthenticatedJson("/delete");
    getOptionalAuthJson("/optional");
    expect(authenticatedMock).toHaveBeenCalledWith("POST", "/post", {
      value: 1,
    });
    expect(authenticatedMock).toHaveBeenCalledWith("GET", "/get");
    expect(authenticatedMock).toHaveBeenCalledWith("PATCH", "/patch", {
      value: 2,
    });
    expect(authenticatedMock).toHaveBeenCalledWith("PUT", "/put", { value: 3 });
    expect(authenticatedMock).toHaveBeenCalledWith("DELETE", "/delete");
    expect(optionalMock).toHaveBeenCalledWith("GET", "/optional");
  });

  it("adds device identifiers to local and OAuth requests", () => {
    authApi.login({ username: "u", password: "p", captchaToken: "c" });
    authApi.signup({
      firstName: "A",
      lastName: "B",
      username: "u",
      email: "a@example.com",
      password: "p",
      captchaToken: "c",
    });
    authApi.verifyEmail({ email: "a@example.com", code: "123" });
    authApi.resetPassword({ username: "u", code: "123", newPassword: "new" });
    authApi.unlockLocalLogin({ email: "a@example.com", code: "123" });
    authApi.authenticateWithGoogle({ nonce: "nonce", code: "code" });
    authApi.authenticateWithMicrosoft({ nonce: "nonce", idToken: "id" });
    authApi.authenticateWithApple({ nonce: "nonce", idToken: "id" });
    authApi.linkOAuthProvider("google", { nonce: "nonce", code: "code" });
    expect(publicMock).toHaveBeenCalledWith(
      "POST",
      "/auth/local/login",
      expect.objectContaining({ deviceId: "device-1" }),
    );
    expect(publicMock).toHaveBeenCalledWith(
      "POST",
      "/auth/oauth/microsoft",
      expect.objectContaining({ deviceId: "device-1" }),
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/oauth/google/link",
      expect.objectContaining({ deviceId: "device-1" }),
    );
  });

  it("covers recovery, device, provider, session, and PAT endpoints", () => {
    authApi.logout();
    authApi.verifyLocalSession();
    authApi.linkedOAuthProviders();
    authApi.unlinkOAuthProvider("apple");
    authApi.resendVerificationEmail({
      email: "a@example.com",
      captchaToken: "c",
    });
    authApi.forgotPassword({ username: "u", captchaToken: "c" });
    authApi.resendForgotPassword({ username: "u", captchaToken: "c" });
    authApi.forgotUsername({ email: "a@example.com", captchaToken: "c" });
    authApi.resendUnlockLocalLogin({
      email: "a@example.com",
      captchaToken: "c",
    });
    authApi.changePassword({ currentPassword: "old", newPassword: "new" });
    authApi.setPassword({ newPassword: "new" });
    authApi.verifyDevice();
    authApi.listKnownDevices();
    authApi.removeKnownDevice("device-2");
    authApi.listPersonalAccessTokens();
    authApi.createPersonalAccessToken({
      name: "CLI",
      expiresInDays: 30,
      scopes: ["mcp:read"],
    });
    authApi.revokePersonalAccessToken("token-1");
    authApi.refresh();
    authApi.hasRefreshCookieHint();
    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/auth/oauth/apple",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/auth/devices/remove",
      { deviceId: "device-2" },
    );
    expect(tokenCreateMock).toHaveBeenCalledWith({
      name: "CLI",
      expiresInDays: 30,
      scopes: ["mcp:read"],
    });
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/auth/local/password/set",
      { newPassword: "new", deviceId: "device-1" },
    );
    expect(tokenRevokeMock).toHaveBeenCalledWith("token-1");
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(hintMock).toHaveBeenCalledOnce();
  });
});
