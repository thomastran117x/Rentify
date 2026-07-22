import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { AuthController } from "@/features/auth/auth.controller";
import { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import BadRequestError from "@/errors/http/bad-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type {
  AuthSessionResult,
  AuthUserProfile,
} from "@/features/auth/auth.model";
import {
  createPatPrincipal,
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

function createAuthUser(
  overrides: Partial<AuthUserProfile> = {},
): AuthUserProfile {
  return {
    id: "user-1",
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    username: "test-user",
    phoneNumber: undefined,
    avatarUrl: undefined,
    isPrivate: false,
    recommendationPersonalizationEnabled: true,
    trustworthinessScore: 80,
    rentPostingsCount: 0,
    availableRentPostingsCount: 0,
    role: "user",
    emailVerified: true,
    organizationMembershipCount: 0,
    ...overrides,
  };
}

function createSessionResult(
  overrides: Partial<AuthSessionResult> = {},
): AuthSessionResult {
  return {
    accessToken: "access-token-1",
    refreshToken: "refresh-token-1",
    refreshTokenExpiresInSeconds: 86_400,
    device: {
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    },
    user: createAuthUser(),
    ...overrides,
  };
}

function createApp() {
  const authService = {
    localAuthenticate: jest.fn(async () => createSessionResult()),
    localSignup: jest.fn(async () => ({
      verificationRequired: true,
      email: "user@example.com",
      alreadyPending: false,
    })),
    forgotPassword: jest.fn(async () => ({
      accepted: true,
    })),
    forgotUsername: jest.fn(async () => ({
      accepted: true,
    })),
    resendForgotPassword: jest.fn(async () => ({
      accepted: true,
    })),
    resetPassword: jest.fn(async () =>
      createSessionResult({
        accessToken: "reset-access-token",
        refreshToken: "reset-refresh-token",
      }),
    ),
    verifyEmail: jest.fn(async () =>
      createSessionResult({
        accessToken: "verified-access-token",
        refreshToken: "verified-refresh-token",
      }),
    ),
    resendVerificationEmail: jest.fn(async () => ({
      accepted: true,
    })),
    unlockLocalLogin: jest.fn(async () => ({
      unlocked: true,
    })),
    resendUnlockLocalLogin: jest.fn(async () => ({
      accepted: true,
    })),
    changePassword: jest.fn(async () =>
      createSessionResult({
        accessToken: "changed-access-token",
        refreshToken: "changed-refresh-token",
      }),
    ),
    localVerify: jest.fn(async () => ({
      verified: true,
    })),
    googleAuthenticate: jest.fn(async () => createSessionResult()),
    microsoftAuthenticate: jest.fn(async () => createSessionResult()),
    appleAuthenticate: jest.fn(async () =>
      createSessionResult({
        accessToken: "apple-access-token",
        refreshToken: "apple-refresh-token",
      }),
    ),
    linkOAuthProvider: jest.fn(async () => ({
      linked: true,
    })),
    linkedOAuthProviders: jest.fn(async () => ({
      providers: ["google"],
    })),
    unlinkOAuthProvider: jest.fn(async () => ({
      unlinked: true,
    })),
    refresh: jest.fn(async () =>
      createSessionResult({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      }),
    ),
    logout: jest.fn(async () => ({
      loggedOut: true,
    })),
    deviceVerify: jest.fn(async () => ({
      verified: true,
    })),
    devices: jest.fn(async () => ({
      devices: [
        {
          id: "device-1",
          lastSeenAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    })),
    removeKnownDevice: jest.fn(async () => ({
      removed: true,
      deviceId: "device-2",
    })),
  };

  const mfaVerificationService = {
    assertRecentVerification: jest.fn(async () => {}),
  };

  const captchaService = {
    verify: jest.fn(async () => ({
      success: true,
      failOpen: false,
      errors: [] as string[],
    })),
  };

  const personalAccessTokenService = {
    authenticateToken: jest.fn(async () => createPatPrincipal()),
    listForUser: jest.fn(async () => ({
      tokens: [
        {
          id: "pat-1",
          name: "Rentify MCP",
          scopes: ["mcp:read"],
        },
      ],
    })),
    create: jest.fn(async () => ({
      id: "pat-1",
      name: "Rentify MCP",
      tokenPrefix: "rpat_prefix",
      scopes: ["mcp:read", "mcp:write"],
      token:
        "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      lastUsedAt: undefined,
      expiresAt: "2026-07-01T00:00:00.000Z",
      revokedAt: undefined,
    })),
    revoke: jest.fn(async () => ({
      revoked: true,
      tokenId: "pat-1",
    })),
  };

  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "user-token") {
        return createJwtClaims({
          sub: "user-1",
          email: "user@example.com",
          role: "user",
        });
      }

      throw new UnauthorizedError("Invalid access token signature.");
    }),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.authController,
      new AuthController(
        authService as any,
        captchaService as any,
        {} as any,
        mfaVerificationService as any,
      ),
    ],
    [
      containerTokens.personalAccessTokenController,
      new PersonalAccessTokenController(personalAccessTokenService as any),
    ],
    [containerTokens.tokenService, tokenService],
    [containerTokens.personalAccessTokenService, personalAccessTokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    authService,
    captchaService,
    personalAccessTokenService,
    tokenService,
  };
}

function jsonHeaders(token?: string) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "content-type": "application/json",
  };
}

describe("Auth routes integration", () => {
  it("covers recovery, verification, unlock, password change, and refresh endpoints", async () => {
    const { app, authService, captchaService } = createApp();

    const forgotResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/password/forgot")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          username: "OWNER-ONE",
          captchaToken: "forgot-captcha",
        }),
      },
    );
    const resendForgotResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/password/forgot/resend")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          username: "OWNER-ONE",
          captchaToken: "resend-forgot-captcha",
        }),
      },
    );
    const forgotUsernameResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/username/forgot")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "OWNER1@rentify.local",
          captchaToken: "forgot-username-captcha",
        }),
      },
    );
    const resetResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/password/reset")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          username: "OWNER-ONE",
          code: "123456",
          newPassword: "ResetPassword1!",
          deviceId: "reset-device",
        }),
      },
    );
    const verifyEmailResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/email/verify")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "USER@example.com",
          code: "123456",
          deviceId: "verify-device",
        }),
      },
    );
    const resendVerifyResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/email/resend")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "USER@example.com",
          captchaToken: "verify-captcha",
        }),
      },
    );
    const unlockResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/unlock")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "USER@example.com",
          code: "654321",
        }),
      },
    );
    const resendUnlockResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/unlock/resend")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "USER@example.com",
          captchaToken: "unlock-captcha",
        }),
      },
    );
    const changePasswordResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/password/change")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        }),
      },
    );
    const refreshResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          refreshToken: "refresh-body-token",
        }),
      },
    );

    expect(forgotResponse.status).toBe(202);
    expect(resendForgotResponse.status).toBe(202);
    expect(forgotUsernameResponse.status).toBe(202);
    expect(resetResponse.status).toBe(200);
    expect(verifyEmailResponse.status).toBe(200);
    expect(resendVerifyResponse.status).toBe(202);
    expect(unlockResponse.status).toBe(200);
    expect(resendUnlockResponse.status).toBe(202);
    expect(changePasswordResponse.status).toBe(200);
    expect(refreshResponse.status).toBe(200);

    expect(captchaService.verify).toHaveBeenCalledTimes(5);
    expect(authService.forgotPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "owner-one",
      }),
    );
    expect(authService.forgotUsername).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner1@rentify.local",
      }),
    );
    expect(authService.resendForgotPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "owner-one",
      }),
    );
    expect(authService.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "owner-one",
        code: "123456",
        deviceId: "reset-device",
      }),
    );
    expect(authService.verifyEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        code: "123456",
        deviceId: "verify-device",
      }),
    );
    expect(authService.resendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
      }),
    );
    expect(authService.unlockLocalLogin).toHaveBeenCalledWith({
      email: "user@example.com",
      code: "654321",
    });
    expect(authService.resendUnlockLocalLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
      }),
    );
    expect(authService.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword1!",
      }),
    );
    expect(authService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: "refresh-body-token",
      }),
    );
  });

  it("covers apple oauth, provider linking, provider listing, device, and logout-adjacent auth endpoints", async () => {
    const { app, authService } = createApp();

    const appleResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/apple")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          idToken: "apple-id-token",
          nonce: "apple-nonce",
        }),
      },
    );
    const linkedProvidersResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/providers")}`,
      {
        headers: jsonHeaders("user-token"),
      },
    );
    const linkProviderResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/google/link")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          code: "oauth-code",
          codeVerifier: "oauth-verifier",
          nonce: "oauth-nonce",
          rememberMe: true,
          deviceId: "oauth-device",
          firstName: "OAuth",
          lastName: "User",
        }),
      },
    );
    const unlinkProviderResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/google")}`,
      {
        method: "DELETE",
        headers: jsonHeaders("user-token"),
      },
    );
    const deviceVerifyResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/device/verify")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
      },
    );
    const devicesResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/devices")}`,
      {
        headers: jsonHeaders("user-token"),
      },
    );
    const removeDeviceResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/devices/remove")}`,
      {
        method: "DELETE",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          deviceId: "device-2",
        }),
      },
    );

    expect(appleResponse.status).toBe(200);
    expect(linkedProvidersResponse.status).toBe(200);
    expect(linkProviderResponse.status).toBe(200);
    expect(unlinkProviderResponse.status).toBe(200);
    expect(deviceVerifyResponse.status).toBe(200);
    expect(devicesResponse.status).toBe(200);
    expect(removeDeviceResponse.status).toBe(200);

    expect(authService.appleAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "apple-id-token",
        nonce: "apple-nonce",
      }),
    );
    expect(authService.linkedOAuthProviders).toHaveBeenCalledWith({
      userId: "user-1",
    });
    expect(authService.linkOAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        provider: "google",
        code: "oauth-code",
      }),
    );
    expect(authService.unlinkOAuthProvider).toHaveBeenCalledWith({
      userId: "user-1",
      provider: "google",
    });
    expect(authService.deviceVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          sub: "user-1",
        }),
      }),
    );
    expect(authService.devices).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          sub: "user-1",
        }),
      }),
    );
    expect(authService.removeKnownDevice).toHaveBeenCalledWith({
      userId: "user-1",
      deviceId: "device-2",
    });
  });

  it("covers personal access token list, create, and revoke endpoints", async () => {
    const { app, personalAccessTokenService } = createApp();

    const listResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        headers: jsonHeaders("user-token"),
      },
    );
    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          name: "Rentify MCP",
          scopes: ["mcp:read", "mcp:write"],
          expiresInDays: 30,
        }),
      },
    );
    const revokeResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens/pat-1")}`,
      {
        method: "DELETE",
        headers: jsonHeaders("user-token"),
      },
    );

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(201);
    expect(revokeResponse.status).toBe(200);
    expect(personalAccessTokenService.listForUser).toHaveBeenCalledWith(
      "user-1",
    );
    expect(personalAccessTokenService.create).toHaveBeenCalledWith({
      userId: "user-1",
      name: "Rentify MCP",
      scopes: ["mcp:read", "mcp:write"],
      expiresAt: undefined,
      expiresInDays: 30,
    });
    expect(personalAccessTokenService.revoke).toHaveBeenCalledWith({
      userId: "user-1",
      tokenId: "pat-1",
    });
  });

  it("returns structured validation and authorization failures for auth edge cases", async () => {
    const { app, authService, personalAccessTokenService } = createApp();
    authService.refresh.mockImplementationOnce(async () => {
      throw new BadRequestError("Refresh token is required.");
    });

    const invalidSchemeResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/password/change")}`,
      {
        method: "POST",
        headers: {
          authorization: "Token user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        }),
      },
    );
    const invalidAppleOauthResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/apple")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          nonce: "apple-nonce",
        }),
      },
    );
    const missingRefreshResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      },
    );
    const invalidRemoveDeviceResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/devices/remove")}`,
      {
        method: "DELETE",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({}),
      },
    );
    const patProvidersResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/providers")}`,
      {
        headers: jsonHeaders(
          "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
        ),
      },
    );

    expect(invalidSchemeResponse.status).toBe(401);
    await expect(invalidSchemeResponse.json()).resolves.toEqual({
      success: false,
      message: "Authorization header must use the Bearer scheme.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidAppleOauthResponse.status).toBe(400);
    await expect(invalidAppleOauthResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(missingRefreshResponse.status).toBe(400);
    await expect(missingRefreshResponse.json()).resolves.toEqual({
      success: false,
      message: "Refresh token is required.",
      data: null,
      error: {
        code: "BAD_REQUEST",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidRemoveDeviceResponse.status).toBe(400);
    await expect(invalidRemoveDeviceResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(patProvidersResponse.status).toBe(403);
    await expect(patProvidersResponse.json()).resolves.toEqual({
      success: false,
      message: "Personal access tokens cannot access this endpoint.",
      data: null,
      error: {
        code: "FORBIDDEN",
        details: {
          method: "GET",
          pathname: "/auth/oauth/providers",
          authMethod: "pat",
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
    expect(personalAccessTokenService.authenticateToken).toHaveBeenCalledTimes(
      1,
    );
  });

  it("rejects invalid local auth and oauth bodies before captcha or auth services run", async () => {
    const { app, authService, captchaService } = createApp();

    const invalidLoginResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "user@example.com",
          password: "Password1!",
        }),
      },
    );
    const invalidSignupResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/signup")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "user@example.com",
          password: "weak",
          captchaToken: "signup-captcha",
        }),
      },
    );
    const invalidGoogleOauthResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/google")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          nonce: "google-nonce",
        }),
      },
    );

    for (const response of [
      invalidLoginResponse,
      invalidSignupResponse,
      invalidGoogleOauthResponse,
    ]) {
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        message: "Request body validation failed.",
        error: {
          code: "VALIDATION_ERROR",
        },
      });
    }

    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(authService.localAuthenticate).not.toHaveBeenCalled();
    expect(authService.localSignup).not.toHaveBeenCalled();
    expect(authService.googleAuthenticate).not.toHaveBeenCalled();
  });

  it("rejects captcha fail-open results, invalid bearer tokens, PAT session-only access, and invalid oauth providers", async () => {
    const { app, authService, captchaService } = createApp();
    captchaService.verify.mockResolvedValueOnce({
      success: true,
      failOpen: true,
      errors: ["captcha-unavailable"],
    });

    const failOpenCaptchaResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          username: "test-user",
          password: "Password1!",
          captchaToken: "login-captcha",
        }),
      },
    );
    const invalidLogoutTokenResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/logout")}`,
      {
        method: "POST",
        headers: jsonHeaders("broken-token"),
      },
    );
    const patSessionOnlyResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        headers: jsonHeaders(
          "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
        ),
      },
    );
    const invalidProviderResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/not-a-provider")}`,
      {
        method: "DELETE",
        headers: jsonHeaders("user-token"),
      },
    );

    expect(failOpenCaptchaResponse.status).toBe(400);
    await expect(failOpenCaptchaResponse.json()).resolves.toEqual({
      success: false,
      message: "Captcha verification failed.",
      data: null,
      error: {
        code: "BAD_REQUEST",
        details: {
          errors: ["captcha-unavailable"],
          failOpen: true,
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
    expect(authService.localAuthenticate).not.toHaveBeenCalled();

    expect(invalidLogoutTokenResponse.status).toBe(401);
    await expect(invalidLogoutTokenResponse.json()).resolves.toEqual({
      success: false,
      message: "Invalid access token signature.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });
    expect(authService.logout).not.toHaveBeenCalled();

    expect(patSessionOnlyResponse.status).toBe(403);
    await expect(patSessionOnlyResponse.json()).resolves.toEqual({
      success: false,
      message: "Personal access tokens cannot access this endpoint.",
      data: null,
      error: {
        code: "FORBIDDEN",
        details: {
          method: "GET",
          pathname: "/auth/personal-access-tokens",
          authMethod: "pat",
        },
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidProviderResponse.status).toBe(400);
    await expect(invalidProviderResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Route parameter validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(authService.unlinkOAuthProvider).not.toHaveBeenCalled();
  });

  it("validates personal access token creation edge cases", async () => {
    const { app, personalAccessTokenService } = createApp();

    const missingExpiryResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          name: "Rentify MCP",
          scopes: ["mcp:read"],
        }),
      },
    );
    const conflictingExpiryResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          name: "Rentify MCP",
          scopes: ["mcp:read"],
          expiresAt: "2026-07-01T00:00:00.000Z",
          expiresInDays: 30,
        }),
      },
    );
    const normalizedScopesResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: jsonHeaders("user-token"),
        body: JSON.stringify({
          name: "Rentify MCP",
          scopes: ["mcp:read", "mcp:read", "mcp:write"],
          expiresInDays: 30,
        }),
      },
    );

    expect(missingExpiryResponse.status).toBe(400);
    await expect(missingExpiryResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(conflictingExpiryResponse.status).toBe(400);
    await expect(conflictingExpiryResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request body validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(normalizedScopesResponse.status).toBe(201);
    expect(personalAccessTokenService.create).toHaveBeenLastCalledWith({
      userId: "user-1",
      name: "Rentify MCP",
      scopes: ["mcp:read", "mcp:write"],
      expiresAt: undefined,
      expiresInDays: 30,
    });
  });
});
