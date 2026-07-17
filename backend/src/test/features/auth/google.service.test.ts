const mockGetOptionalEnvironmentVariable = jest.fn();

jest.mock("@/configuration/environment", () => {
  const actual = jest.requireActual("@/configuration/environment");

  return {
    ...actual,
    getOptionalEnvironmentVariable: (name: string) =>
      mockGetOptionalEnvironmentVariable(name),
  };
});

import BadRequestError from "@/errors/http/bad-request.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { GoogleOAuthService } from "@/features/auth/oauth/google.service";

function setEnvironment(values: Record<string, string | undefined>) {
  mockGetOptionalEnvironmentVariable.mockImplementation(
    (name: string) => values[name],
  );
}

describe("GoogleOAuthService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockGetOptionalEnvironmentVariable.mockReset();
  });

  it("exchanges the authorization code, verifies the id token, and normalizes the Google profile", async () => {
    setEnvironment({
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
      FRONTEND_URL: "https://rent.example.com",
    });
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () => ({
        sub: "google-user-1",
        email: "USER@Example.com",
        email_verified: "true",
        given_name: "Google",
        family_name: "User",
      })),
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id_token: "google-id-token",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    const service = new GoogleOAuthService(tokenVerifier as any);

    const profile = await service.verify({
      code: "auth-code",
      codeVerifier: "pkce-verifier",
      nonce: "nonce-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
    });
    expect((init?.body as URLSearchParams).toString()).toBe(
      "code=auth-code&client_id=google-client-id&redirect_uri=https%3A%2F%2Frent.example.com%2Fauth%2Fgoogle&grant_type=authorization_code&code_verifier=pkce-verifier&client_secret=google-client-secret",
    );
    expect(tokenVerifier.verifyIdToken).toHaveBeenCalledWith(
      "google-id-token",
      {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: ["google-client-id"],
        jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
        allowedHosts: ["www.googleapis.com"],
        nonce: "nonce-1",
      },
    );
    expect(profile).toEqual({
      provider: "google",
      providerUserId: "google-user-1",
      email: "user@example.com",
      emailVerified: true,
      firstName: "Google",
      lastName: "User",
    });
  });

  it("prefers caller-supplied names over Google token profile names", async () => {
    setEnvironment({
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
    });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "google-id-token" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () => ({
        sub: "google-user-2",
        email: "user@example.com",
        email_verified: true,
        given_name: "Ignored",
        family_name: "Name",
      })),
    };
    const service = new GoogleOAuthService(tokenVerifier as any);

    const profile = await service.verify({
      code: "auth-code",
      codeVerifier: "pkce-verifier",
      nonce: "nonce-2",
      firstName: "Chosen",
      lastName: "Person",
    });

    expect(profile.firstName).toBe("Chosen");
    expect(profile.lastName).toBe("Person");
  });

  it("rejects missing PKCE inputs before contacting Google", async () => {
    setEnvironment({
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
    });
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const service = new GoogleOAuthService({
      verifyIdToken: jest.fn(),
    } as any);

    await expect(
      service.verify({
        nonce: "nonce-3",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Google authorization code exchange is missing PKCE inputs.",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unverified Google accounts", async () => {
    setEnvironment({
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
    });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id_token: "google-id-token" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const service = new GoogleOAuthService({
      verifyIdToken: jest.fn(async () => ({
        sub: "google-user-3",
        email: "user@example.com",
        email_verified: false,
      })),
    } as any);

    await expect(
      service.verify({
        code: "auth-code",
        codeVerifier: "pkce-verifier",
        nonce: "nonce-4",
      }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({
      message: "Google account email is not verified.",
    });
  });

  it("maps Google token endpoint infrastructure failures to service unavailable", async () => {
    setEnvironment({
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
    });
    jest.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNRESET" },
      }),
    );
    const service = new GoogleOAuthService({
      verifyIdToken: jest.fn(),
    } as any);

    await expect(
      service.verify({
        code: "auth-code",
        codeVerifier: "pkce-verifier",
        nonce: "nonce-5",
      }),
    ).rejects.toMatchObject<Partial<ServiceNotAvaliableError>>({
      status: 503,
      code: "SERVICE_NOT_AVALIABLE",
      message: "Google authorization service is currently unavailable.",
      details: expect.objectContaining({
        provider: "google",
        reason: "ECONNRESET",
      }),
    });
  });

  it("maps Google token endpoint server errors to service unavailable", async () => {
    setEnvironment({
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
    });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const service = new GoogleOAuthService({
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
      details: expect.objectContaining({
        provider: "google",
        status: 503,
      }),
    });
  });
});
