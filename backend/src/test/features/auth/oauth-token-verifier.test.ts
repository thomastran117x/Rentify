const mockCreatePublicKey = jest.fn();
const mockVerify = jest.fn();
const mockAssertTrustedOutboundUrl = jest.fn((url: string, _options?: unknown) => new URL(url));

jest.mock("node:crypto", () => ({
  createPublicKey: (key: unknown) => mockCreatePublicKey(key),
  verify: (
    algorithm: unknown,
    data: unknown,
    key: unknown,
    signature: unknown,
  ) => mockVerify(algorithm, data, key, signature),
}));

jest.mock("@/features/security/outbound-request-guard", () => ({
  assertTrustedOutboundUrl: (url: string, options?: unknown) =>
    mockAssertTrustedOutboundUrl(url, options),
}));

import BadRequestError from "@/errors/http/bad-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { OAuthTokenVerifier } from "@/features/auth/oauth/oauth-token-verifier";

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createToken(overrides?: {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signature?: string;
}) {
  const header = encodeSegment({
    alg: "RS256",
    kid: "kid-1",
    typ: "JWT",
    ...overrides?.header,
  });
  const payload = encodeSegment({
    sub: "user-1",
    aud: "rent-web",
    iss: "https://issuer.example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: "nonce-1",
    email: "user@example.com",
    ...overrides?.payload,
  });
  const signature =
    overrides?.signature ?? Buffer.from("sig").toString("base64url");

  return `${header}.${payload}.${signature}`;
}

function createJwksResponse(keys: unknown[]) {
  return {
    status: 200,
    ok: true,
    json: async () => ({
      keys,
    }),
  };
}

function readVerifierCache() {
  return (
    OAuthTokenVerifier as unknown as {
      jwksCache: Map<string, unknown>;
    }
  ).jwksCache;
}

describe("OAuthTokenVerifier", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readVerifierCache().clear();
    mockCreatePublicKey.mockReturnValue("public-key");
    mockVerify.mockReturnValue(true);
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn();
  });

  it("rejects invalid token formatting and malformed JSON segments", async () => {
    const verifier = new OAuthTokenVerifier();
    const options = {
      issuer: "https://issuer.example.com",
      audience: "rent-web",
      jwksUrl: "https://issuer.example.com/jwks",
      nonce: "nonce-1",
    };

    await expect(
      verifier.verifyIdToken("bad-token", options),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      verifier.verifyIdToken(
        `bad.${encodeSegment({ sub: "user-1" })}.sig`,
        options,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      verifier.verifyIdToken(
        `${encodeSegment({ alg: "RS256" })}.bad.sig`,
        options,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects invalid algorithm, audience, issuer, nonce, expiry, and not-before claims", async () => {
    const verifier = new OAuthTokenVerifier();
    const options = {
      issuer: "https://issuer.example.com",
      audience: "rent-web",
      jwksUrl: "https://issuer.example.com/jwks",
      nonce: "nonce-1",
    };

    await expect(
      verifier.verifyIdToken(
        createToken({ header: { alg: "HS256" } }),
        options,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      verifier.verifyIdToken(
        createToken({ payload: { aud: "other-app" } }),
        options,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      verifier.verifyIdToken(
        createToken({ payload: { iss: "https://other.example.com" } }),
        options,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      verifier.verifyIdToken(
        createToken({ payload: { nonce: "wrong-nonce" } }),
        options,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      verifier.verifyIdToken(
        createToken({ payload: { exp: Math.floor(Date.now() / 1000) - 1 } }),
        options,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      verifier.verifyIdToken(
        createToken({ payload: { nbf: Math.floor(Date.now() / 1000) + 300 } }),
        options,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("verifies a valid token with a matching RSA JWK and caches the fetched key set", async () => {
    const fetchMock = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch;
    fetchMock.mockResolvedValue(
      createJwksResponse([
        {
          kid: "kid-1",
          kty: "RSA",
          n: "modulus",
          e: "AQAB",
        },
      ]),
    );
    const verifier = new OAuthTokenVerifier();
    const options = {
      issuer: "https://issuer.example.com",
      audience: ["rent-web", "rent-mobile"],
      jwksUrl: "https://issuer.example.com/jwks",
      nonce: "nonce-1",
      allowedHosts: ["issuer.example.com"],
    };

    const payload = await verifier.verifyIdToken(createToken(), options);
    const secondPayload = await verifier.verifyIdToken(createToken(), options);

    expect(payload.email).toBe("user@example.com");
    expect(secondPayload.sub).toBe("user-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockAssertTrustedOutboundUrl).toHaveBeenCalledWith(
      "https://issuer.example.com/jwks",
      {
        allowedHosts: ["issuer.example.com"],
      },
    );
    expect(mockCreatePublicKey).toHaveBeenCalledWith({
      key: {
        kty: "RSA",
        n: "modulus",
        e: "AQAB",
      },
      format: "jwk",
    });
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });

  it("supports x5c certificate keys and rejects invalid signatures", async () => {
    const fetchMock = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch;
    fetchMock.mockResolvedValue(
      createJwksResponse([
        {
          kid: "kid-1",
          x5c: ["certificate-data"],
        },
      ]),
    );
    mockVerify.mockReturnValueOnce(false);
    const verifier = new OAuthTokenVerifier();

    await expect(
      verifier.verifyIdToken(createToken(), {
        issuer: "https://issuer.example.com",
        audience: "rent-web",
        jwksUrl: "https://issuer.example.com/jwks",
        nonce: "nonce-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(mockCreatePublicKey).toHaveBeenCalledWith(
      "-----BEGIN CERTIFICATE-----\ncertificate-data\n-----END CERTIFICATE-----",
    );
  });

  it("rejects missing signing keys and unsupported signing key material", async () => {
    const fetchMock = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch;
    const verifier = new OAuthTokenVerifier();

    fetchMock.mockResolvedValueOnce(
      createJwksResponse([
        {
          kid: "other-kid",
          kty: "RSA",
          n: "modulus",
          e: "AQAB",
        },
        {
          kid: "other-kid-2",
          kty: "RSA",
          n: "modulus-2",
          e: "AQAB",
        },
      ]),
    );

    await expect(
      verifier.verifyIdToken(createToken(), {
        issuer: "https://issuer.example.com",
        audience: "rent-web",
        jwksUrl: "https://issuer.example.com/jwks",
        nonce: "nonce-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    readVerifierCache().clear();
    fetchMock.mockResolvedValueOnce(
      createJwksResponse([
        {
          kid: "kid-1",
          kty: "oct",
        },
      ]),
    );

    await expect(
      verifier.verifyIdToken(createToken(), {
        issuer: "https://issuer.example.com",
        audience: "rent-web",
        jwksUrl: "https://issuer.example.com/jwks",
        nonce: "nonce-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("retries transient JWKS failures before succeeding", async () => {
    const fetchMock = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch;
    fetchMock
      .mockResolvedValueOnce({
        status: 500,
        ok: false,
      })
      .mockResolvedValueOnce(
        createJwksResponse([
          {
            kid: "kid-1",
            kty: "RSA",
            n: "modulus",
            e: "AQAB",
          },
        ]),
      );
    const verifier = new OAuthTokenVerifier({
      maxRetries: 1,
      initialDelayMs: 1,
      maxDelayMs: 1,
    });
    jest
      .spyOn(
        verifier as unknown as { sleep(delayMs: number): Promise<void> },
        "sleep",
      )
      .mockResolvedValue(undefined);

    await expect(
      verifier.verifyIdToken(createToken(), {
        issuer: "https://issuer.example.com",
        audience: "rent-web",
        jwksUrl: "https://issuer.example.com/jwks",
        nonce: "nonce-1",
      }),
    ).resolves.toMatchObject({
      sub: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when JWKS fetching returns non-transient or empty results", async () => {
    const fetchMock = (global as typeof globalThis & { fetch: jest.Mock })
      .fetch;
    const verifier = new OAuthTokenVerifier({
      maxRetries: 1,
      initialDelayMs: 1,
      maxDelayMs: 1,
    });
    jest
      .spyOn(
        verifier as unknown as { sleep(delayMs: number): Promise<void> },
        "sleep",
      )
      .mockResolvedValue(undefined);

    fetchMock.mockResolvedValueOnce({
      status: 404,
      ok: false,
    });

    await expect(
      verifier.verifyIdToken(createToken(), {
        issuer: "https://issuer.example.com",
        audience: "rent-web",
        jwksUrl: "https://issuer.example.com/jwks",
        nonce: "nonce-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    readVerifierCache().clear();
    fetchMock.mockResolvedValueOnce(createJwksResponse([]));

    await expect(
      verifier.verifyIdToken(createToken(), {
        issuer: "https://issuer.example.com",
        audience: "rent-web",
        jwksUrl: "https://issuer.example.com/jwks",
        nonce: "nonce-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps abort and fetch network errors to transient verifier failures", async () => {
    const verifier = new OAuthTokenVerifier();
    const helper = verifier as unknown as {
      mapRequestError(error: unknown): Error;
      normalizeError(error: unknown): { code: string; transient: boolean };
      calculateDelayMs(attempt: number): number;
    };
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const networkError = Object.assign(new TypeError("fetch failed"), {
      cause: {
        code: "ECONNREFUSED",
      },
    });
    const originalRandom = Math.random;
    Math.random = () => 0.5;

    try {
      expect(helper.mapRequestError(abortError).message).toContain("timed out");
      expect(helper.mapRequestError(networkError).message).toContain("failed");
      expect(helper.normalizeError(abortError)).toEqual({
        code: "oauth-jwks-timeout",
        transient: true,
      });
      expect(helper.normalizeError(networkError)).toEqual({
        code: "ECONNREFUSED",
        transient: true,
      });
      expect(helper.normalizeError(new Error("permanent"))).toEqual({
        code: "permanent",
        transient: false,
      });
      expect(helper.calculateDelayMs(0)).toBeGreaterThanOrEqual(250);
    } finally {
      Math.random = originalRandom;
    }
  });
});
