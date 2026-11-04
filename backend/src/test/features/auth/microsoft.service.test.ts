const mockGetOptionalEnvironmentVariable = jest.fn();

jest.mock("@/configuration/environment", () => {
  const actual = jest.requireActual("@/configuration/environment");

  return {
    ...actual,
    environment: {
      ...actual.environment,
      getMicrosoftOAuthConfig: () => ({
        audiences: [
          mockGetOptionalEnvironmentVariable("MICROSOFT_OAUTH_CLIENT_ID"),
        ].filter((value): value is string => Boolean(value)),
        clientSecret: mockGetOptionalEnvironmentVariable(
          "MICROSOFT_OAUTH_CLIENT_SECRET",
        ),
        tenant:
          mockGetOptionalEnvironmentVariable("MICROSOFT_OAUTH_TENANT") ??
          "consumers",
        verifiedEmailPolicy: mockGetOptionalEnvironmentVariable(
          "MICROSOFT_OAUTH_VERIFIED_EMAIL_POLICY",
        ),
        frontendBaseUrl:
          mockGetOptionalEnvironmentVariable("FRONTEND_URL") ??
          "http://localhost:3040",
      }),
    },
    getOptionalEnvironmentVariable: (name: string) =>
      mockGetOptionalEnvironmentVariable(name),
  };
});

import BadRequestError from "@/errors/http/bad-request.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  MICROSOFT_CONSUMER_TENANT_ID,
  MicrosoftOAuthService,
} from "@/features/auth/oauth/microsoft.service";

function setEnvironment(values: Record<string, string | undefined>) {
  mockGetOptionalEnvironmentVariable.mockImplementation(
    (name: string) => values[name],
  );
}

describe("MicrosoftOAuthService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockGetOptionalEnvironmentVariable.mockReset();
  });

  it("exchanges the authorization code, verifies the id token, and maps the Microsoft profile", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-client-secret",
      MICROSOFT_OAUTH_TENANT: "common",
      FRONTEND_URL: "https://rent.example.com",
    });
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () => ({
        sub: "microsoft-user-1",
        email: "USER@Example.com",
        email_verified: true,
        name: "Microsoft Person",
      })),
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id_token: "microsoft-id-token",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    const service = new MicrosoftOAuthService(tokenVerifier as any);

    const profile = await service.verify({
      code: "auth-code",
      codeVerifier: "pkce-verifier",
      nonce: "nonce-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    expect((init?.body as URLSearchParams).toString()).toBe(
      "code=auth-code&client_id=microsoft-client-id&redirect_uri=https%3A%2F%2Frent.example.com%2Fauth%2Fmicrosoft&grant_type=authorization_code&code_verifier=pkce-verifier&scope=openid+email+profile&client_secret=microsoft-client-secret",
    );
    expect(tokenVerifier.verifyIdToken).toHaveBeenCalledWith(
      "microsoft-id-token",
      {
        issuer: [
          "https://login.microsoftonline.com/common/v2.0",
          "https://login.microsoftonline.com/consumers/v2.0",
          "https://login.microsoftonline.com/organizations/v2.0",
          "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
        ],
        audience: ["microsoft-client-id"],
        jwksUrl: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
        allowedHosts: ["login.microsoftonline.com"],
        nonce: "nonce-1",
      },
    );
    expect(profile).toEqual({
      provider: "microsoft",
      providerUserId: "microsoft-user-1",
      email: "user@example.com",
      emailVerified: true,
      firstName: "Microsoft",
      lastName: "Person",
    });
  });

  it("uses a provided Microsoft id token without exchanging the authorization code", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
    });
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () => ({
        sub: "microsoft-user-2",
        email: "direct@example.com",
        tid: MICROSOFT_CONSUMER_TENANT_ID,
        name: "Direct Person",
      })),
    };
    const service = new MicrosoftOAuthService(tokenVerifier as any);

    const profile = await service.verify({
      idToken: "pre-issued-id-token",
      nonce: "nonce-2",
      firstName: "Chosen",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(profile).toEqual({
      provider: "microsoft",
      providerUserId: "microsoft-user-2",
      email: "direct@example.com",
      emailVerified: true,
      firstName: "Chosen",
      lastName: "Person",
    });
  });

  it("rejects missing PKCE inputs when no Microsoft id token is supplied", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
    });
    const service = new MicrosoftOAuthService({
      verifyIdToken: jest.fn(),
    } as any);

    await expect(
      service.verify({
        nonce: "nonce-3",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Microsoft authorization code exchange is missing PKCE inputs.",
    });
  });

  it("rejects Microsoft tokens that are missing required identity claims", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
    });
    const service = new MicrosoftOAuthService({
      verifyIdToken: jest.fn(async () => ({
        name: "No Email User",
      })),
    } as any);

    await expect(
      service.verify({
        idToken: "broken-id-token",
        nonce: "nonce-4",
      }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({
      message: "Microsoft ID token is missing required claims.",
    });
  });

  it("does not accept preferred_username as verified email ownership", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
    });
    const service = new MicrosoftOAuthService({
      verifyIdToken: jest.fn(async () => ({
        sub: "microsoft-user-3",
        preferred_username: "alias@example.com",
        name: "Alias Person",
      })),
    } as any);

    await expect(
      service.verify({
        idToken: "preferred-username-only-token",
        nonce: "nonce-5",
      }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({
      message: "Microsoft ID token is missing required claims.",
    });
  });

  it("accepts the consumer tenant's issuer id when the tenant is consumers", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_TENANT: "consumers",
    });
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () => ({
        sub: "microsoft-user-4",
        email: "person@outlook.com",
        tid: MICROSOFT_CONSUMER_TENANT_ID,
      })),
    };
    const service = new MicrosoftOAuthService(tokenVerifier as any);

    await service.verify({ idToken: "consumer-token", nonce: "nonce-7" });

    expect(tokenVerifier.verifyIdToken).toHaveBeenCalledWith(
      "consumer-token",
      expect.objectContaining({
        issuer: [
          "https://login.microsoftonline.com/consumers/v2.0",
          "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
        ],
        jwksUrl:
          "https://login.microsoftonline.com/consumers/discovery/v2.0/keys",
      }),
    );
  });

  it.each([
    {
      case: "a business-tenant token with no email_verified claim",
      claims: { tid: "11111111-2222-3333-4444-555555555555" },
      policy: undefined,
    },
    {
      case: "a token with no tid and no email_verified claim",
      claims: {},
      policy: undefined,
    },
    {
      case: "an explicit email_verified false, even from the consumer tenant",
      claims: { tid: MICROSOFT_CONSUMER_TENANT_ID, email_verified: "false" },
      policy: undefined,
    },
    {
      case: "xms_edov while the policy only trusts email_verified",
      claims: { tid: "11111111-2222-3333-4444-555555555555", xms_edov: true },
      policy: "email_verified",
    },
    {
      case: "xms_edov false under the xms_edov policy",
      claims: { tid: "11111111-2222-3333-4444-555555555555", xms_edov: false },
      policy: "email_verified_or_xms_edov",
    },
  ])("rejects $case", async ({ claims, policy }) => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_TENANT: "organizations",
      MICROSOFT_OAUTH_VERIFIED_EMAIL_POLICY: policy,
    });
    const service = new MicrosoftOAuthService({
      verifyIdToken: jest.fn(async () => ({
        sub: "microsoft-user-5",
        email: "ceo@victim.example",
        ...claims,
      })),
    } as any);

    await expect(
      service.verify({ idToken: "tenant-token", nonce: "nonce-8" }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({
      message: "Microsoft account email is not verified.",
    });
  });

  it.each([
    {
      case: "email_verified true from a business tenant",
      claims: {
        tid: "11111111-2222-3333-4444-555555555555",
        email_verified: "true",
      },
      policy: "email_verified",
    },
    {
      case: "xms_edov under the xms_edov policy",
      claims: { tid: "11111111-2222-3333-4444-555555555555", xms_edov: "true" },
      policy: "email_verified_or_xms_edov",
    },
  ])("accepts $case", async ({ claims, policy }) => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_TENANT: "organizations",
      MICROSOFT_OAUTH_VERIFIED_EMAIL_POLICY: policy,
    });
    const service = new MicrosoftOAuthService({
      verifyIdToken: jest.fn(async () => ({
        sub: "microsoft-user-6",
        email: "staff@business.example",
        ...claims,
      })),
    } as any);

    await expect(
      service.verify({ idToken: "tenant-token", nonce: "nonce-9" }),
    ).resolves.toMatchObject({ emailVerified: true });
  });

  it("maps Microsoft token endpoint infrastructure failures to service unavailable", async () => {
    setEnvironment({
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_TENANT: "consumers",
    });
    jest.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ETIMEDOUT" },
      }),
    );
    const service = new MicrosoftOAuthService({
      verifyIdToken: jest.fn(),
    } as any);

    await expect(
      service.verify({
        code: "auth-code",
        codeVerifier: "pkce-verifier",
        nonce: "nonce-6",
      }),
    ).rejects.toMatchObject<Partial<ServiceNotAvaliableError>>({
      status: 503,
      code: "SERVICE_NOT_AVALIABLE",
      message: "Microsoft authorization service is currently unavailable.",
      details: expect.objectContaining({
        provider: "microsoft",
        reason: "ETIMEDOUT",
      }),
    });
  });
});
