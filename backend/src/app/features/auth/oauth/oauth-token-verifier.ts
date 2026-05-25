import { createPublicKey, verify } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { assertTrustedOutboundUrl } from "@/features/security/outbound-request-guard";

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean | string;
  given_name?: string;
  family_name?: string;
  name?: string;
  preferred_username?: string;
  nonce?: string;
  [key: string]: unknown;
}

interface JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
}

interface JsonWebKeySet {
  keys?: JsonWebKey[];
}

interface VerifyJwtOptions {
  issuer: string | string[];
  audience: string | string[];
  jwksUrl: string;
  allowedHosts?: string[];
  allowedAlgorithms?: string[];
  nonce?: string;
}

interface OAuthTokenVerifierOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  requestTimeoutMs?: number;
}

type NormalizedError = Readonly<{
  code: string;
  transient: boolean;
}>;

const DEFAULTS = {
  maxRetries: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  backoffMultiplier: 2,
  requestTimeoutMs: 3_000,
} as const;

const TRANSIENT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromBase64UrlJson<TValue>(input: string, label: string): TValue {
  try {
    return JSON.parse(
      Buffer.from(input, "base64url").toString("utf8"),
    ) as TValue;
  } catch {
    throw new BadRequestError(`OAuth token ${label} is malformed.`);
  }
}

function asArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function matchesAudience(
  expectedAudience: string | string[],
  actualAudience: string | string[] | undefined,
): boolean {
  if (!actualAudience) {
    return false;
  }

  const expected = asArray(expectedAudience);
  const actual = asArray(actualAudience);

  return actual.some((value) => expected.includes(value));
}

function matchesIssuer(
  expectedIssuer: string | string[],
  actualIssuer: string | undefined,
): boolean {
  if (!actualIssuer) {
    return false;
  }

  return asArray(expectedIssuer).includes(actualIssuer);
}

function getJwkPublicKey(jwk: JsonWebKey): ReturnType<typeof createPublicKey> {
  if (jwk.x5c?.length) {
    const certificate = jwk.x5c[0];

    if (!certificate) {
      throw new UnauthorizedError("OAuth signing certificate is missing.");
    }

    const pem = `-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`;
    return createPublicKey(pem);
  }

  if (jwk.kty === "RSA" && jwk.n && jwk.e) {
    return createPublicKey({
      key: {
        kty: "RSA",
        n: jwk.n,
        e: jwk.e,
      },
      format: "jwk",
    });
  }

  throw new UnauthorizedError("OAuth signing key is not supported.");
}

export class OAuthTokenVerifier {
  private static readonly jwksCache = new Map<
    string,
    {
      expiresAt: number;
      keys: JsonWebKey[];
    }
  >();
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly requestTimeoutMs: number;

  constructor(options: OAuthTokenVerifierOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
    this.backoffMultiplier =
      options.backoffMultiplier ?? DEFAULTS.backoffMultiplier;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
  }

  async verifyIdToken(
    token: string,
    options: VerifyJwtOptions,
  ): Promise<JwtPayload> {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new BadRequestError("OAuth ID token format is invalid.");
    }

    const header = fromBase64UrlJson<JwtHeader>(encodedHeader, "header");
    const payload = fromBase64UrlJson<JwtPayload>(encodedPayload, "payload");
    const allowedAlgorithms = options.allowedAlgorithms ?? ["RS256"];

    if (!header.alg || !allowedAlgorithms.includes(header.alg)) {
      throw new UnauthorizedError("OAuth token algorithm is invalid.");
    }

    if (!matchesAudience(options.audience, payload.aud)) {
      throw new UnauthorizedError("OAuth token audience is invalid.");
    }

    if (!matchesIssuer(options.issuer, payload.iss)) {
      throw new UnauthorizedError("OAuth token issuer is invalid.");
    }

    if (options.nonce && payload.nonce !== options.nonce) {
      throw new UnauthorizedError("OAuth token nonce is invalid.");
    }

    this.assertTokenTimes(payload);

    const signingKey = await this.findSigningKey(
      options.jwksUrl,
      header.kid,
      options.allowedHosts,
    );
    const verified = verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
      getJwkPublicKey(signingKey),
      Buffer.from(encodedSignature, "base64url"),
    );

    if (!verified) {
      throw new UnauthorizedError("OAuth token signature is invalid.");
    }

    return payload;
  }

  private assertTokenTimes(payload: JwtPayload): void {
    const now = Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== "number" || payload.exp <= now) {
      throw new UnauthorizedError("OAuth token has expired.");
    }

    if (typeof payload.nbf === "number" && payload.nbf > now) {
      throw new UnauthorizedError("OAuth token is not active yet.");
    }
  }

  private async findSigningKey(
    jwksUrl: string,
    kid?: string,
    allowedHosts?: string[],
  ): Promise<JsonWebKey> {
    const keys = await this.fetchJwks(jwksUrl, allowedHosts);

    if (kid) {
      const matchingKey = keys.find((key) => key.kid === kid);

      if (matchingKey) {
        return matchingKey;
      }
    }

    if (keys.length === 1) {
      const [singleKey] = keys;

      if (singleKey) {
        return singleKey;
      }
    }

    throw new UnauthorizedError("OAuth signing key was not found.");
  }

  private async fetchJwks(
    jwksUrl: string,
    allowedHosts?: string[],
  ): Promise<JsonWebKey[]> {
    const cached = OAuthTokenVerifier.jwksCache.get(jwksUrl);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.keys;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const keys = await this.fetchJwksOnce(jwksUrl, allowedHosts);

        OAuthTokenVerifier.jwksCache.set(jwksUrl, {
          keys,
          expiresAt: Date.now() + 60 * 60 * 1000,
        });

        return keys;
      } catch (error) {
        const normalized = this.normalizeError(error);

        if (!normalized.transient || attempt === this.maxRetries) {
          throw new UnauthorizedError(
            "OAuth provider verification is currently unavailable.",
            {
              reason: normalized.code,
              failClosed: true,
            },
          );
        }

        await this.sleep(this.calculateDelayMs(attempt));
      }
    }

    throw new UnauthorizedError(
      "OAuth provider verification is currently unavailable.",
      {
        reason: "oauth-jwks-unavailable",
        failClosed: true,
      },
    );
  }

  private async fetchJwksOnce(
    jwksUrl: string,
    allowedHosts?: string[],
  ): Promise<JsonWebKey[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );
    const trustedJwksUrl = assertTrustedOutboundUrl(jwksUrl, {
      allowedHosts,
    }).toString();

    try {
      const response = await fetch(trustedJwksUrl, {
        signal: controller.signal,
      });

      if (response.status >= 500) {
        throw new OAuthVerifierTransientError(
          `OAuth JWKS responded with ${response.status}.`,
          {
            code: `oauth-jwks-http-${response.status}`,
          },
        );
      }

      if (!response.ok) {
        throw new UnauthorizedError("OAuth signing keys could not be fetched.");
      }

      const body = (await response.json()) as JsonWebKeySet;
      const keys = body.keys ?? [];

      if (!keys.length) {
        throw new UnauthorizedError("OAuth signing keys are unavailable.");
      }

      return keys;
    } catch (error) {
      throw this.mapRequestError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private mapRequestError(error: unknown): Error {
    if (this.isAbortError(error)) {
      return new OAuthVerifierTransientError("OAuth JWKS request timed out.", {
        code: "oauth-jwks-timeout",
      });
    }

    if (this.isFetchNetworkError(error)) {
      return new OAuthVerifierTransientError("OAuth JWKS request failed.", {
        code: this.readNodeErrorCode(error) ?? "oauth-jwks-network-error",
      });
    }

    return error instanceof Error
      ? error
      : new Error("oauth-jwks-fetch-failed");
  }

  private normalizeError(error: unknown): NormalizedError {
    if (error instanceof OAuthVerifierTransientError) {
      return {
        code: error.code ?? "oauth-jwks-transient-error",
        transient: true,
      };
    }

    const code = this.readNodeErrorCode(error);

    if (code && TRANSIENT_ERROR_CODES.has(code)) {
      return {
        code,
        transient: true,
      };
    }

    if (this.isAbortError(error)) {
      return {
        code: "oauth-jwks-timeout",
        transient: true,
      };
    }

    return {
      code: this.toErrorCode(error),
      transient: false,
    };
  }

  private calculateDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      this.initialDelayMs * this.backoffMultiplier ** attempt,
      this.maxDelayMs,
    );
    const jitterMs = Math.floor(
      Math.random() * Math.max(25, Math.floor(this.initialDelayMs / 2)),
    );

    return exponentialDelay + jitterMs;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private isFetchNetworkError(error: unknown): boolean {
    if (!(error instanceof Error) || error.name !== "TypeError") {
      return false;
    }

    return (
      this.readNodeErrorCode(error) !== undefined ||
      /fetch failed/i.test(error.message)
    );
  }

  private readNodeErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("cause" in error)) {
      return undefined;
    }

    const cause = (error as { cause?: unknown }).cause;

    if (typeof cause !== "object" || cause === null || !("code" in cause)) {
      return undefined;
    }

    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  private toErrorCode(error: unknown): string {
    if (error instanceof OAuthVerifierTransientError && error.code) {
      return error.code;
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "oauth-jwks-fetch-failed";
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

class OAuthVerifierTransientError extends Error {
  constructor(
    message: string,
    private readonly details: { code?: string } = {},
  ) {
    super(message);
    this.name = "OAuthVerifierTransientError";
  }

  get code(): string | undefined {
    return this.details.code;
  }
}
