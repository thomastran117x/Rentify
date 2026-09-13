const mockAppleConfig: {
  audiences: string[];
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  frontendBaseUrl: string;
} = {
  audiences: [],
  frontendBaseUrl: "http://localhost:3040",
};

jest.mock("@/configuration/environment", () => {
  const actual = jest.requireActual("@/configuration/environment");

  return {
    ...actual,
    environment: {
      ...actual.environment,
      getAppleOAuthConfig: () => mockAppleConfig,
    },
  };
});

import { generateKeyPairSync, verify } from "node:crypto";
import BadGatewayError from "@/errors/http/bad-gateway.error";
import BadRequestError from "@/errors/http/bad-request.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  AppleOAuthService,
  createAppleClientSecret,
} from "@/features/auth/oauth/apple.service";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const privateKeyPem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

function configure(overrides: Partial<typeof mockAppleConfig> = {}) {
  Object.assign(mockAppleConfig, {
    audiences: ["com.rentify.web"],
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    privateKey: privateKeyPem,
    frontendBaseUrl: "https://rent.example.com",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function verifiedClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: "apple-user-1",
    email: "Relay@PrivateRelay.AppleID.com",
    email_verified: "true",
    ...overrides,
  };
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("AppleOAuthService", () => {
  beforeEach(() => configure());

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("verifies a client-supplied id token without contacting the token endpoint", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () => verifiedClaims()),
    };
    const service = new AppleOAuthService(tokenVerifier as any);

    const profile = await service.verify({
      idToken: "apple-id-token",
      nonce: "nonce-1",
      firstName: "Apple",
      lastName: "User",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokenVerifier.verifyIdToken).toHaveBeenCalledWith("apple-id-token", {
      issuer: "https://appleid.apple.com",
      audience: ["com.rentify.web"],
      jwksUrl: "https://appleid.apple.com/auth/keys",
      allowedHosts: ["appleid.apple.com"],
      nonce: "nonce-1",
    });
    expect(profile).toEqual({
      provider: "apple",
      providerUserId: "apple-user-1",
      email: "relay@privaterelay.appleid.com",
      emailVerified: true,
      firstName: "Apple",
      lastName: "User",
    });
  });

  it("exchanges an authorization code using a signed ES256 client secret", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id_token: "exchanged-id-token" }));
    const tokenVerifier = {
      verifyIdToken: jest.fn(async () =>
        verifiedClaims({ email_verified: true }),
      ),
    };
    const service = new AppleOAuthService(tokenVerifier as any);

    const profile = await service.verify({
      code: "apple-code",
      codeVerifier: "pkce-verifier",
      nonce: "nonce-2",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://appleid.apple.com/auth/token");
    expect(init).toMatchObject({ method: "POST" });
    const body = init?.body as URLSearchParams;
    expect(body.get("client_id")).toBe("com.rentify.web");
    expect(body.get("code")).toBe("apple-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(
      "https://rent.example.com/auth/apple",
    );
    expect(body.get("code_verifier")).toBe("pkce-verifier");

    const [header, payload, signature] = body
      .get("client_secret")!
      .split(".") as [string, string, string];
    expect(decodeSegment(header)).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
    });
    expect(decodeSegment(payload)).toMatchObject({
      iss: "TEAM123456",
      aud: "https://appleid.apple.com",
      sub: "com.rentify.web",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`, "utf8"),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(tokenVerifier.verifyIdToken).toHaveBeenCalledWith(
      "exchanged-id-token",
      expect.objectContaining({ nonce: "nonce-2" }),
    );
    expect(profile.firstName).toBeUndefined();
  });

  it("omits the code verifier when none was supplied", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id_token: "exchanged-id-token" }));
    const service = new AppleOAuthService({
      verifyIdToken: jest.fn(async () => verifiedClaims()),
    } as any);

    await service.verify({ code: "apple-code", nonce: "nonce-3" });

    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has("code_verifier")).toBe(false);
  });

  it("builds a client secret that expires five minutes after issue", () => {
    const secret = createAppleClientSecret(
      {
        clientId: "com.rentify.web",
        teamId: "TEAM123456",
        keyId: "KEY1234567",
        privateKey: privateKeyPem,
      },
      1_000,
    );

    expect(decodeSegment(secret.split(".")[1]!)).toMatchObject({
      iat: 1_000,
      exp: 1_300,
    });
  });

  it("rejects requests with neither an id token nor a code", async () => {
    const service = new AppleOAuthService({ verifyIdToken: jest.fn() } as any);

    await expect(service.verify({ nonce: "nonce-4" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it.each([
    [{ audiences: [] }],
    [{ teamId: undefined }],
    [{ keyId: undefined }],
    [{ privateKey: undefined }],
  ])(
    "reports Apple as not configured for a code exchange (%#)",
    async (overrides) => {
      configure(overrides);
      const fetchMock = jest.spyOn(globalThis, "fetch");
      const service = new AppleOAuthService({
        verifyIdToken: jest.fn(),
      } as any);

      await expect(
        service.verify({ code: "apple-code", nonce: "nonce-5" }),
      ).rejects.toMatchObject({ message: "Apple OAuth is not configured." });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("reports Apple as not configured when verifying an id token without a client ID", async () => {
    configure({ audiences: [] });
    const service = new AppleOAuthService({ verifyIdToken: jest.fn() } as any);

    await expect(
      service.verify({ idToken: "apple-id-token", nonce: "nonce-6" }),
    ).rejects.toMatchObject({ message: "Apple OAuth is not configured." });
  });

  it.each([[{ sub: undefined }], [{ email: undefined }]])(
    "rejects tokens missing required claims (%#)",
    async (overrides) => {
      const service = new AppleOAuthService({
        verifyIdToken: jest.fn(async () => verifiedClaims(overrides)),
      } as any);

      await expect(
        service.verify({ idToken: "apple-id-token", nonce: "nonce-7" }),
      ).rejects.toMatchObject<Partial<UnauthorizedError>>({
        message: "Apple ID token is missing required claims.",
      });
    },
  );

  it("rejects unverified Apple emails", async () => {
    const service = new AppleOAuthService({
      verifyIdToken: jest.fn(async () =>
        verifiedClaims({ email_verified: "false" }),
      ),
    } as any);

    await expect(
      service.verify({ idToken: "apple-id-token", nonce: "nonce-8" }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({
      message: "Apple account email is not verified.",
    });
  });

  it.each([
    [
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNRESET" },
      }),
      "ECONNRESET",
    ],
    [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout"],
    [Object.assign(new Error("dns"), { code: "ENOTFOUND" }), "ENOTFOUND"],
    [new Error("unknown"), "network-error"],
  ])(
    "maps token endpoint network failures to service unavailable (%#)",
    async (error, reason) => {
      jest.spyOn(globalThis, "fetch").mockRejectedValue(error);
      const service = new AppleOAuthService({
        verifyIdToken: jest.fn(),
      } as any);

      await expect(
        service.verify({ code: "apple-code", nonce: "nonce-9" }),
      ).rejects.toMatchObject<Partial<ServiceNotAvaliableError>>({
        status: 503,
        details: expect.objectContaining({ provider: "apple", reason }),
      });
    },
  );

  it("maps token endpoint server errors to service unavailable", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ error: "server_error" }, 502));
    const service = new AppleOAuthService({ verifyIdToken: jest.fn() } as any);

    await expect(
      service.verify({ code: "apple-code", nonce: "nonce-10" }),
    ).rejects.toMatchObject<Partial<ServiceNotAvaliableError>>({
      status: 503,
      details: expect.objectContaining({
        provider: "apple",
        status: 502,
        reason: "server_error",
      }),
    });
  });

  it.each([
    [
      { error: "invalid_grant", error_description: "Code expired" },
      "Code expired",
    ],
    [{ error: "invalid_grant" }, "invalid_grant"],
    [{}, "Apple authorization code exchange failed."],
  ])("rejects failed code exchanges (%#)", async (responseBody, message) => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(responseBody, 400));
    const service = new AppleOAuthService({
      verifyIdToken: jest.fn(),
    } as any);

    await expect(
      service.verify({ code: "apple-code", nonce: "nonce-11" }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({ message });
  });

  it("rejects token responses without an id token", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
    const service = new AppleOAuthService({ verifyIdToken: jest.fn() } as any);

    await expect(
      service.verify({ code: "apple-code", nonce: "nonce-12" }),
    ).rejects.toMatchObject<Partial<UnauthorizedError>>({
      message: "Apple token response did not include an ID token.",
    });
  });

  it("maps unparseable token responses to a bad gateway", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>", { status: 200 }));
    const service = new AppleOAuthService({ verifyIdToken: jest.fn() } as any);

    await expect(
      service.verify({ code: "apple-code", nonce: "nonce-13" }),
    ).rejects.toBeInstanceOf(BadGatewayError);
  });
});
