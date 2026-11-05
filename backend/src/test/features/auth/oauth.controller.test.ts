import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import type { CaptchaService } from "@/features/auth/captcha/captcha.service";
import type { OAuthAccountsService } from "@/features/auth/oauth/oauth-accounts.service";
import type { OAuthFlowService } from "@/features/auth/oauth/oauth-flow.service";
import { OAuthController } from "@/features/auth/oauth/oauth.controller";
import {
  createClaims,
  createContext,
  createSessionResult,
  invoke,
  type AuthTestContext,
} from "../../support/auth-controller-harness";
import { testUuid } from "../../support/uuid";

const USER_15_ID = testUuid(9000, 822530);

const mockRequireJwtAuth = jest.fn();
const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: jest.fn(),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

const providersResult = {
  hasPassword: true,
  providers: [
    {
      id: "identity-1",
      provider: "google" as const,
      providerEmail: "user@example.com",
      emailVerified: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function createController() {
  const oauthAccountsService = {
    googleAuthenticate: jest.fn(async () => createSessionResult()),
    microsoftAuthenticate: jest.fn(async () => createSessionResult()),
    appleAuthenticate: jest.fn(async () =>
      createSessionResult({ isNewUser: true }),
    ),
    completeSignup: jest.fn(async () =>
      createSessionResult({ isNewUser: true }),
    ),
    linkOAuthProvider: jest.fn(async () => providersResult),
    linkedOAuthProviders: jest.fn(async () => providersResult),
    unlinkOAuthProvider: jest.fn(async () => providersResult),
  };
  const captchaService = {
    verify: jest.fn<Promise<{ success: boolean }>, [unknown]>(async () => ({
      success: true,
    })),
  };
  const oauthFlowService = {
    start: jest.fn(async () => ({
      state: "server-state",
      nonce: "server-nonce",
      codeChallenge: "server-challenge",
      tokenDelivery: "code" as const,
      expiresInSeconds: 600,
    })),
  };

  return {
    oauthAccountsService,
    captchaService,
    oauthFlowService,
    controller: new OAuthController(
      oauthAccountsService as unknown as OAuthAccountsService,
      oauthFlowService as unknown as OAuthFlowService,
      captchaService as unknown as CaptchaService,
      {} as MfaVerificationService,
    ),
  };
}

const oauthBody = {
  state: "oauth-state",
  code: "oauth-code",
  // A client still on the old contract: both are dropped, never trusted.
  codeVerifier: "oauth-verifier",
  nonce: "oauth-nonce",
  rememberMe: true,
  deviceId: "oauth-device",
  firstName: "OAuth",
  lastName: "User",
  dateOfBirth: "2012-06-15",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireJwtAuth.mockResolvedValue(createClaims());
  // A signed-in caller with a proof, unless a test says otherwise.
  mockRequireRecentMfaVerification.mockImplementation(
    (request: AuthTestContext["request"]) => mockRequireJwtAuth(request),
  );
});

describe("OAuthController sign-in handlers", () => {
  it("maps the body onto the google service input", async () => {
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.googleAuthenticate,
      createContext({ body: oauthBody }),
    );

    expect(oauthAccountsService.googleAuthenticate).toHaveBeenCalledWith({
      state: "oauth-state",
      code: "oauth-code",
      idToken: undefined,
      rememberMe: true,
      client: expect.any(Object),
      firstName: "OAuth",
      lastName: "User",
      deviceId: "oauth-device",
      totpCode: undefined,
      dateOfBirth: "2012-06-15",
      audit: {
        ipAddress: "127.0.0.1",
        deviceId: "oauth-device",
        userAgent: "test-agent",
        requestId: "request-test",
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Authenticated successfully.",
    });
  });

  it("routes microsoft sign-in to the microsoft service", async () => {
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.microsoftAuthenticate,
      createContext({ body: oauthBody }),
    );

    expect(oauthAccountsService.microsoftAuthenticate).toHaveBeenCalled();
    expect(oauthAccountsService.googleAuthenticate).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("accepts an id token in place of a code", async () => {
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.appleAuthenticate,
      createContext({ body: { idToken: "id-token", state: "apple-state" } }),
    );

    expect(oauthAccountsService.appleAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "id-token", state: "apple-state" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { isNewUser: true },
    });
  });

  it.each([
    ["neither an id token nor a code", { state: "oauth-state" }],
    [
      "both an id token and a code",
      { state: "oauth-state", code: "oauth-code", idToken: "id-token" },
    ],
    [
      "no state, even with a client nonce",
      { idToken: "id-token", nonce: "client-nonce" },
    ],
  ])("rejects a body with %s", async (_label, body) => {
    const { controller, oauthAccountsService } = createController();

    await expect(
      invoke(controller.googleAuthenticate, createContext({ body })),
    ).rejects.toMatchObject({ name: "RequestValidationError" });
    expect(oauthAccountsService.googleAuthenticate).not.toHaveBeenCalled();
  });

  it("does not authenticate the caller for a sign-in handler", async () => {
    const { controller } = createController();

    await invoke(
      controller.googleAuthenticate,
      createContext({ body: oauthBody }),
    );

    expect(mockRequireJwtAuth).not.toHaveBeenCalled();
  });

  it("returns an accepted continuation when a new OAuth user needs a date of birth", async () => {
    const { controller, oauthAccountsService } = createController();
    oauthAccountsService.googleAuthenticate.mockResolvedValueOnce({
      signupRequired: true,
      signupToken: "signup-token",
      expiresInSeconds: 600,
    } as never);

    const response = await invoke(
      controller.googleAuthenticate,
      createContext({ body: oauthBody }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        signupRequired: true,
        signupToken: "signup-token",
        expiresInSeconds: 600,
      },
    });
  });

  it("completes an OAuth signup with a valid continuation and date of birth", async () => {
    const { controller, oauthAccountsService, captchaService } =
      createController();

    const response = await invoke(
      controller.completeSignup,
      createContext({
        body: {
          signupToken: "signup-token",
          dateOfBirth: "2012-06-15",
          deviceId: "oauth-device",
          captchaToken: "signup-captcha",
        },
      }),
    );

    expect(captchaService.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "signup-captcha",
        expectedAction: "oauth_signup",
      }),
    );

    expect(oauthAccountsService.completeSignup).toHaveBeenCalledWith({
      client: expect.any(Object),
      signupToken: "signup-token",
      dateOfBirth: "2012-06-15",
      deviceId: "oauth-device",
      audit: {
        ipAddress: "127.0.0.1",
        deviceId: "oauth-device",
        userAgent: "test-agent",
        requestId: "request-test",
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Signup completed successfully.",
      data: { isNewUser: true },
    });
  });

  it("does not complete an OAuth signup when the captcha fails", async () => {
    const { controller, oauthAccountsService, captchaService } =
      createController();
    captchaService.verify.mockResolvedValueOnce({ success: false });

    await expect(
      invoke(
        controller.completeSignup,
        createContext({
          body: {
            signupToken: "signup-token",
            dateOfBirth: "2012-06-15",
            captchaToken: "bad",
          },
        }),
      ),
    ).rejects.toThrow("Captcha verification failed.");
    expect(oauthAccountsService.completeSignup).not.toHaveBeenCalled();
  });

  it("requires a captcha token to complete an OAuth signup", async () => {
    const { controller, oauthAccountsService } = createController();

    await expect(
      invoke(
        controller.completeSignup,
        createContext({
          body: { signupToken: "signup-token", dateOfBirth: "2012-06-15" },
        }),
      ),
    ).rejects.toThrow("Request body validation failed.");
    expect(oauthAccountsService.completeSignup).not.toHaveBeenCalled();
  });
});

describe("OAuthController.startFlow", () => {
  it("starts a sign-in without authenticating the caller", async () => {
    const { controller, oauthFlowService } = createController();

    const response = await invoke(
      controller.startFlow,
      createContext({
        params: { provider: "google" },
        body: { intent: "login", deviceId: "start-device" },
      }),
    );

    expect(mockRequireJwtAuth).not.toHaveBeenCalled();
    expect(oauthFlowService.start).toHaveBeenCalledWith({
      provider: "google",
      intent: "login",
      deviceId: "start-device",
      userId: undefined,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "OAuth sign-in started.",
      data: {
        state: "server-state",
        nonce: "server-nonce",
        codeChallenge: "server-challenge",
        tokenDelivery: "code",
        expiresInSeconds: 600,
      },
    });
  });

  it("authenticates a link start and binds it to the caller", async () => {
    const auth = createClaims({ sub: USER_15_ID });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, oauthFlowService } = createController();

    await invoke(
      controller.startFlow,
      createContext({
        auth,
        params: { provider: "microsoft" },
        body: { intent: "link" },
      }),
    );

    expect(mockRequireJwtAuth).toHaveBeenCalled();
    expect(oauthFlowService.start).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "microsoft",
        intent: "link",
        userId: USER_15_ID,
      }),
    );
  });

  it("does not start a link for an unauthenticated caller", async () => {
    mockRequireJwtAuth.mockRejectedValue(new Error("unauthenticated"));
    const { controller, oauthFlowService } = createController();

    await expect(
      invoke(
        controller.startFlow,
        createContext({
          params: { provider: "google" },
          body: { intent: "link" },
        }),
      ),
    ).rejects.toThrow("unauthenticated");
    expect(oauthFlowService.start).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    const { controller, oauthFlowService } = createController();

    await expect(
      invoke(
        controller.startFlow,
        createContext({
          params: { provider: "google" },
          body: { intent: "takeover" },
        }),
      ),
    ).rejects.toMatchObject({ name: "RequestValidationError" });
    expect(oauthFlowService.start).not.toHaveBeenCalled();
  });
});

describe("OAuthController link and unlink", () => {
  it("needs a step-up, then links the route provider to the caller", async () => {
    const auth = createClaims({ sub: USER_15_ID });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.linkOAuthProvider,
      createContext({ auth, params: { provider: "google" }, body: oauthBody }),
    );

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
    expect(oauthAccountsService.linkOAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", userId: USER_15_ID }),
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "OAuth provider linked successfully.",
    });
  });

  it("lists the providers linked to the caller", async () => {
    const auth = createClaims({ sub: USER_15_ID });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.linkedOAuthProviders,
      createContext({ auth }),
    );

    expect(oauthAccountsService.linkedOAuthProviders).toHaveBeenCalledWith({
      userId: USER_15_ID,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { hasPassword: true },
    });
  });

  it("unlinks the route provider from the caller", async () => {
    const auth = createClaims({ sub: USER_15_ID });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.unlinkOAuthProvider,
      createContext({ auth, params: { provider: "microsoft" } }),
    );

    expect(oauthAccountsService.unlinkOAuthProvider).toHaveBeenCalledWith({
      provider: "microsoft",
      userId: USER_15_ID,
      sessionId: undefined,
      audit: {
        ipAddress: "127.0.0.1",
        deviceId: "token-device-1",
        userAgent: "test-agent",
        requestId: "request-test",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      message: "OAuth provider unlinked successfully.",
    });
  });

  it("leaves the link state unspent and links nothing without a proof", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new MfaVerificationRequiredError(),
    );
    const { controller, oauthAccountsService } = createController();

    await expect(
      invoke(
        controller.linkOAuthProvider,
        createContext({ params: { provider: "google" }, body: oauthBody }),
      ),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);

    expect(oauthAccountsService.linkOAuthProvider).not.toHaveBeenCalled();
  });

  it("unlinks nothing without a proof", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new MfaVerificationRequiredError(),
    );
    const { controller, oauthAccountsService } = createController();

    await expect(
      invoke(
        controller.unlinkOAuthProvider,
        createContext({ params: { provider: "google" } }),
      ),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);

    expect(oauthAccountsService.unlinkOAuthProvider).not.toHaveBeenCalled();
  });

  it("starts a link without a step-up", async () => {
    const { controller, oauthFlowService } = createController();

    await invoke(
      controller.startFlow,
      createContext({
        auth: createClaims({ sub: USER_15_ID }),
        params: { provider: "google" },
        body: { intent: "link", deviceId: "oauth-device" },
      }),
    );

    expect(oauthFlowService.start).toHaveBeenCalled();
    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
  });

  it("rejects an unsupported provider in the route", async () => {
    const auth = createClaims({ sub: USER_15_ID });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, oauthAccountsService } = createController();

    await expect(
      invoke(
        controller.unlinkOAuthProvider,
        createContext({ auth, params: { provider: "invalid-provider" } }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "RequestValidationError",
        message: "Route parameter validation failed.",
      }),
    );
    expect(oauthAccountsService.unlinkOAuthProvider).not.toHaveBeenCalled();
  });
});
