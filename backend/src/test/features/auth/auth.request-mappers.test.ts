import type { Request } from "express";
import { containerTokens } from "@/configuration/container/tokens";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { RequestValidationError } from "@/configuration/validation/request";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import { oauthProviderSchema } from "@/features/auth/auth.model";
import { usernameAvailabilityQuerySchema } from "@/features/auth/username/username.model";
import {
  parseUsernameAvailabilityQuery,
  requireOAuthProviderParam,
  resolveDeviceId,
  toChangePasswordInput,
  toForgotPasswordInput,
  toForgotUsernameInput,
  toLinkOAuthProviderInput,
  toLocalAuthenticateInput,
  toLocalSignupInput,
  toOAuthAuthenticateInput,
  toRefreshInput,
  toRemoveKnownDeviceInput,
  toResendForgotPasswordInput,
  toResendUnlockLocalLoginInput,
  toResendVerificationEmailInput,
  toResetPasswordInput,
  toSetPasswordInput,
  toUnlinkOAuthProviderInput,
  toUnlockLocalLoginInput,
  toVerifyEmailInput,
} from "@/features/auth/auth.request-mappers";
import { createMockRequest, type MockRequestOptions } from "../../support/mock-http";

const client = {
  ip: "203.0.113.10",
  device: {
    id: "fingerprint-device",
    type: "desktop" as const,
    isMobile: false,
  },
};

const auth = { sub: "user-1", deviceId: "session-device" };

// Route-parameter sanitization resolves the sanitizer off the request-scoped
// container, so the mappers that read `:provider` need one present.
function createContainer(): ServiceContainer {
  const contentSanitizationService = new ContentSanitizationService();

  return {
    resolve<TValue>(token: unknown): TValue {
      if (token === containerTokens.contentSanitizationService) {
        return contentSanitizationService as TValue;
      }

      throw new Error(`Unexpected token: ${String(token)}`);
    },
    createScope(): ServiceContainer {
      return this;
    },
    async dispose(): Promise<void> {},
  };
}

function createRequest(options: MockRequestOptions = {}): Request {
  return createMockRequest({
    ...options,
    state: { client, auth, container: createContainer(), ...options.state },
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("resolveDeviceId", () => {
  it("prefers an explicit device id from the body", () => {
    expect(resolveDeviceId(createRequest(), "body-device")).toBe("body-device");
  });

  it("falls back to the fingerprinted device", () => {
    expect(resolveDeviceId(createRequest())).toBe("fingerprint-device");
  });
});

describe("parseUsernameAvailabilityQuery", () => {
  it("parses and normalizes the username", () => {
    expect(
      parseUsernameAvailabilityQuery(
        createRequest({ url: "/auth/username/available?username=Test-User" }),
      ),
    ).toEqual({ username: "test-user" });
  });

  it("reports a missing username as a request validation error", () => {
    expect(() =>
      parseUsernameAvailabilityQuery(
        createRequest({ url: "/auth/username/available" }),
      ),
    ).toThrow(RequestValidationError);
  });

  it("rethrows a non-Zod failure untouched", () => {
    const failure = new Error("boom");
    jest
      .spyOn(usernameAvailabilityQuerySchema, "parse")
      .mockImplementation(() => {
        throw failure;
      });

    expect(() =>
      parseUsernameAvailabilityQuery(
        createRequest({ url: "/auth/username/available?username=test-user" }),
      ),
    ).toThrow(failure);
  });
});

describe("requireOAuthProviderParam", () => {
  it("accepts a supported provider", () => {
    expect(
      requireOAuthProviderParam(
        createRequest({ params: { provider: "google" } }),
      ),
    ).toBe("google");
  });

  it("rejects an unsupported provider", () => {
    expect(() =>
      requireOAuthProviderParam(
        createRequest({ params: { provider: "myspace" } }),
      ),
    ).toThrow(RequestValidationError);
  });

  it("rejects a missing route parameter", () => {
    expect(() => requireOAuthProviderParam(createRequest())).toThrow(
      RequestValidationError,
    );
  });

  it("rethrows a non-Zod failure untouched", () => {
    const failure = new Error("boom");
    jest.spyOn(oauthProviderSchema, "parse").mockImplementation(() => {
      throw failure;
    });

    expect(() =>
      requireOAuthProviderParam(
        createRequest({ params: { provider: "google" } }),
      ),
    ).toThrow(failure);
  });
});

describe("credential mappers", () => {
  it("maps a login body", () => {
    expect(
      toLocalAuthenticateInput(createRequest(), {
        username: "test-user",
        password: "Rentify123!",
        captchaToken: "captcha-ok",
        rememberMe: true,
        deviceId: "body-device",
        totpCode: "123456",
      }),
    ).toEqual({
      username: "test-user",
      password: "Rentify123!",
      rememberMe: true,
      client,
      deviceId: "body-device",
      totpCode: "123456",
    });
  });

  it("maps a signup body", () => {
    expect(
      toLocalSignupInput(createRequest(), {
        username: "test-user",
        email: "user@example.com",
        password: "Rentify123!",
        captchaToken: "captcha-ok",
        firstName: "Test",
        lastName: "User",
        deviceId: undefined,
      }),
    ).toEqual({
      client,
      username: "test-user",
      email: "user@example.com",
      password: "Rentify123!",
      firstName: "Test",
      lastName: "User",
      deviceId: "fingerprint-device",
    });
  });

  it("maps a change-password body onto the authenticated principal", () => {
    expect(
      toChangePasswordInput(createRequest(), {
        currentPassword: "Rentify123!",
        newPassword: "Rentify456!",
      }),
    ).toEqual({
      userId: "user-1",
      client,
      currentPassword: "Rentify123!",
      newPassword: "Rentify456!",
      deviceId: "session-device",
    });
  });

  it("maps a set-password body onto the authenticated principal", () => {
    expect(
      toSetPasswordInput(createRequest(), { newPassword: "Rentify456!" }),
    ).toEqual({
      userId: "user-1",
      client,
      newPassword: "Rentify456!",
      deviceId: "session-device",
    });
  });

  it("falls back to the fingerprinted device when the session carries none", () => {
    const request = createMockRequest({
      state: { client, auth: { sub: "user-1" }, container: createContainer() },
    });

    expect(
      toSetPasswordInput(request, { newPassword: "Rentify456!" }).deviceId,
    ).toBe("fingerprint-device");
  });

  it("maps a reset-password body", () => {
    expect(
      toResetPasswordInput(createRequest(), {
        username: "test-user",
        code: "123456",
        newPassword: "Rentify456!",
        deviceId: "body-device",
      }),
    ).toEqual({
      client,
      username: "test-user",
      code: "123456",
      newPassword: "Rentify456!",
      deviceId: "body-device",
    });
  });
});

describe("recovery mappers", () => {
  it("maps a forgot-password body", () => {
    expect(
      toForgotPasswordInput(createRequest(), {
        username: "test-user",
        captchaToken: "captcha-ok",
      }),
    ).toEqual({
      client,
      username: "test-user",
      deviceId: "fingerprint-device",
    });
  });

  it("maps a resend-forgot-password body", () => {
    expect(
      toResendForgotPasswordInput(createRequest(), {
        username: "test-user",
        captchaToken: "captcha-ok",
      }),
    ).toEqual({
      client,
      username: "test-user",
      deviceId: "fingerprint-device",
    });
  });

  it("maps a forgot-username body", () => {
    expect(
      toForgotUsernameInput(createRequest(), {
        email: "user@example.com",
        captchaToken: "captcha-ok",
      }),
    ).toEqual({
      client,
      email: "user@example.com",
      deviceId: "fingerprint-device",
    });
  });

  it("maps an unlock body without reading the request", () => {
    expect(
      toUnlockLocalLoginInput({ email: "user@example.com", code: "123456" }),
    ).toEqual({ email: "user@example.com", code: "123456" });
  });

  it("maps a resend-unlock body", () => {
    expect(
      toResendUnlockLocalLoginInput(createRequest(), {
        email: "user@example.com",
        captchaToken: "captcha-ok",
      }),
    ).toEqual({
      client,
      email: "user@example.com",
      deviceId: "fingerprint-device",
    });
  });
});

describe("email verification mappers", () => {
  it("maps a verify-email body", () => {
    expect(
      toVerifyEmailInput(createRequest(), {
        email: "user@example.com",
        code: "123456",
        deviceId: "body-device",
      }),
    ).toEqual({
      client,
      email: "user@example.com",
      code: "123456",
      deviceId: "body-device",
    });
  });

  it("maps a resend-verification body", () => {
    expect(
      toResendVerificationEmailInput(createRequest(), {
        email: "user@example.com",
        captchaToken: "captcha-ok",
      }),
    ).toEqual({
      client,
      email: "user@example.com",
      deviceId: "fingerprint-device",
    });
  });
});

describe("oauth mappers", () => {
  const oauthBody = {
    code: "code-1",
    codeVerifier: "verifier-1",
    idToken: undefined,
    nonce: "nonce-1",
    rememberMe: false,
    deviceId: undefined,
    firstName: "Test",
    lastName: "User",
    totpCode: undefined,
  };

  it("maps an oauth authenticate body", () => {
    expect(toOAuthAuthenticateInput(createRequest(), oauthBody)).toEqual({
      code: "code-1",
      codeVerifier: "verifier-1",
      idToken: undefined,
      nonce: "nonce-1",
      rememberMe: false,
      client,
      firstName: "Test",
      lastName: "User",
      deviceId: "fingerprint-device",
      totpCode: undefined,
    });
  });

  it("adds the route provider and principal when linking", () => {
    expect(
      toLinkOAuthProviderInput(
        createRequest({ params: { provider: "microsoft" } }),
        oauthBody,
      ),
    ).toMatchObject({
      provider: "microsoft",
      userId: "user-1",
      nonce: "nonce-1",
    });
  });

  it("maps an unlink request from the route and principal alone", () => {
    expect(
      toUnlinkOAuthProviderInput(
        createRequest({ params: { provider: "apple" } }),
      ),
    ).toEqual({ provider: "apple", userId: "user-1" });
  });
});

describe("session and device mappers", () => {
  it("prefers a refresh token from the body", () => {
    expect(
      toRefreshInput(createRequest(), { refreshToken: "body-token" }),
    ).toEqual({ client, refreshToken: "body-token" });
  });

  it("falls back to the refresh cookie", () => {
    expect(
      toRefreshInput(
        createRequest({ headers: { cookie: "refresh_token=cookie-token" } }),
        { refreshToken: undefined },
      ),
    ).toEqual({ client, refreshToken: "cookie-token" });
  });

  it("maps a remove-device body onto the principal", () => {
    expect(
      toRemoveKnownDeviceInput(createRequest(), { deviceId: "device-2" }),
    ).toEqual({ userId: "user-1", deviceId: "device-2" });
  });
});
