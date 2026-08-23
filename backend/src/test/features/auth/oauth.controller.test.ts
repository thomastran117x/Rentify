import type { OAuthAccountsService } from "@/features/auth/oauth/oauth-accounts.service";
import { OAuthController } from "@/features/auth/oauth/oauth.controller";
import {
  createClaims,
  createContext,
  createSessionResult,
  invoke,
  type AuthTestContext,
} from "../../support/auth-controller-harness";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: jest.fn(),
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
    linkOAuthProvider: jest.fn(async () => providersResult),
    linkedOAuthProviders: jest.fn(async () => providersResult),
    unlinkOAuthProvider: jest.fn(async () => providersResult),
  };

  return {
    oauthAccountsService,
    controller: new OAuthController(
      oauthAccountsService as unknown as OAuthAccountsService,
    ),
  };
}

const oauthBody = {
  code: "oauth-code",
  codeVerifier: "oauth-verifier",
  nonce: "oauth-nonce",
  rememberMe: true,
  deviceId: "oauth-device",
  firstName: "OAuth",
  lastName: "User",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireJwtAuth.mockResolvedValue(createClaims());
});

describe("OAuthController sign-in handlers", () => {
  it("maps the body onto the google service input", async () => {
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.googleAuthenticate,
      createContext({ body: oauthBody }),
    );

    expect(oauthAccountsService.googleAuthenticate).toHaveBeenCalledWith({
      code: "oauth-code",
      codeVerifier: "oauth-verifier",
      idToken: undefined,
      nonce: "oauth-nonce",
      rememberMe: true,
      client: expect.any(Object),
      firstName: "OAuth",
      lastName: "User",
      deviceId: "oauth-device",
      totpCode: undefined,
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

  it("accepts an id token in place of the PKCE pair", async () => {
    const { controller, oauthAccountsService } = createController();

    const response = await invoke(
      controller.appleAuthenticate,
      createContext({ body: { idToken: "id-token", nonce: "apple-nonce" } }),
    );

    expect(oauthAccountsService.appleAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "id-token", nonce: "apple-nonce" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { isNewUser: true },
    });
  });

  it("rejects a body with neither an id token nor a code pair", async () => {
    const { controller, oauthAccountsService } = createController();

    await expect(
      invoke(
        controller.googleAuthenticate,
        createContext({ body: { nonce: "oauth-nonce" } }),
      ),
    ).rejects.toThrow();
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
});

describe("OAuthController link and unlink", () => {
  it("authenticates, then links the route provider to the caller", async () => {
    const auth = createClaims({ sub: "user-15" });
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

    expect(mockRequireJwtAuth).toHaveBeenCalled();
    expect(oauthAccountsService.linkOAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google", userId: "user-15" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "OAuth provider linked successfully.",
    });
  });

  it("lists the providers linked to the caller", async () => {
    const auth = createClaims({ sub: "user-15" });
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
      userId: "user-15",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { hasPassword: true },
    });
  });

  it("unlinks the route provider from the caller", async () => {
    const auth = createClaims({ sub: "user-15" });
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
      userId: "user-15",
    });
    await expect(response.json()).resolves.toMatchObject({
      message: "OAuth provider unlinked successfully.",
    });
  });

  it("rejects an unsupported provider in the route", async () => {
    const auth = createClaims({ sub: "user-15" });
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
