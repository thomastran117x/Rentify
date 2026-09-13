import { sign } from "node:crypto";
import { environment } from "@/configuration/environment";
import BadRequestError from "@/errors/http/bad-request.error";
import BadGatewayError from "@/errors/http/bad-gateway.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { OAuthTokenVerifier } from "@/features/auth/oauth/oauth-token-verifier";
import { assertTrustedOutboundUrl } from "@/features/security/outbound-request-guard";
import type {
  OAuthAuthenticateInput,
  VerifiedOAuthProfile,
} from "@/features/auth/oauth/oauth.types";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_ALLOWED_HOSTS = ["appleid.apple.com"];
const APPLE_TOKEN_TIMEOUT_MS = 5_000;
const APPLE_CLIENT_SECRET_TTL_SECONDS = 300;

interface AppleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface AppleSigningConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

function readAudiences(): string[] {
  const value = environment.getAppleOAuthConfig().audiences;

  if (value.length === 0) {
    throw new BadRequestError("Apple OAuth is not configured.");
  }

  return value;
}

function readSigningConfig(): AppleSigningConfig {
  const { teamId, keyId, privateKey } = environment.getAppleOAuthConfig();
  const [clientId] = readAudiences();

  if (!clientId || !teamId || !keyId || !privateKey) {
    throw new BadRequestError("Apple OAuth is not configured.");
  }

  return { clientId, teamId, keyId, privateKey };
}

function readFrontendBaseUrl(): string {
  return environment.getAppleOAuthConfig().frontendBaseUrl;
}

function normalizeEmailVerified(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

function toBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Apple has no static client secret: each token request carries a short-lived
 * ES256 JWT signed with the developer account's private key.
 */
export function createAppleClientSecret(
  config: AppleSigningConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = toBase64UrlJson({ alg: "ES256", kid: config.keyId });
  const payload = toBase64UrlJson({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + APPLE_CLIENT_SECRET_TTL_SECONDS,
    aud: APPLE_ISSUER,
    sub: config.clientId,
  });
  const signature = sign(
    "sha256",
    Buffer.from(`${header}.${payload}`, "utf8"),
    { key: config.privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

class AppleOAuthService {
  constructor(private readonly tokenVerifier: OAuthTokenVerifier) {}

  async verify(input: OAuthAuthenticateInput): Promise<VerifiedOAuthProfile> {
    const idToken = input.idToken ?? (await this.exchangeCodeForIdToken(input));
    const payload = await this.tokenVerifier.verifyIdToken(idToken, {
      issuer: APPLE_ISSUER,
      audience: readAudiences(),
      jwksUrl: APPLE_JWKS_URL,
      allowedHosts: APPLE_ALLOWED_HOSTS,
      nonce: input.nonce,
    });

    if (!payload.sub || typeof payload.email !== "string") {
      throw new UnauthorizedError("Apple ID token is missing required claims.");
    }

    const emailVerified = normalizeEmailVerified(payload.email_verified);

    if (!emailVerified) {
      throw new UnauthorizedError("Apple account email is not verified.");
    }

    // Apple never puts the user's name in the token; the client receives it
    // once, on first consent, and forwards it.
    return {
      provider: "apple",
      providerUserId: payload.sub,
      email: payload.email.trim().toLowerCase(),
      emailVerified,
      firstName: input.firstName,
      lastName: input.lastName,
    };
  }

  private async exchangeCodeForIdToken(
    input: OAuthAuthenticateInput,
  ): Promise<string> {
    if (!input.code) {
      throw new BadRequestError(
        "Apple authorization code exchange is missing the authorization code.",
      );
    }

    const signingConfig = readSigningConfig();
    const body = new URLSearchParams({
      client_id: signingConfig.clientId,
      client_secret: createAppleClientSecret(signingConfig),
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: `${readFrontendBaseUrl()}/auth/apple`,
    });

    if (input.codeVerifier) {
      body.set("code_verifier", input.codeVerifier);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      APPLE_TOKEN_TIMEOUT_MS,
    );
    let response: Response;

    try {
      response = await fetch(
        assertTrustedOutboundUrl(APPLE_TOKEN_URL, {
          allowedHosts: APPLE_ALLOWED_HOSTS,
        }),
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body,
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw this.toProviderUnavailableError(error, "token-exchange");
    } finally {
      clearTimeout(timeoutId);
    }

    const payload = await this.readTokenResponse(response);

    if (response.status >= 500) {
      throw new ServiceNotAvaliableError(
        "Apple authorization service is currently unavailable.",
        {
          provider: "apple",
          status: response.status,
          reason: payload.error ?? "provider-server-error",
        },
      );
    }

    if (!response.ok) {
      throw new UnauthorizedError(
        payload.error_description ||
          payload.error ||
          "Apple authorization code exchange failed.",
      );
    }

    if (!payload.id_token) {
      throw new UnauthorizedError(
        "Apple token response did not include an ID token.",
      );
    }

    return payload.id_token;
  }

  private async readTokenResponse(
    response: Response,
  ): Promise<AppleTokenResponse> {
    try {
      return (await response.json()) as AppleTokenResponse;
    } catch {
      throw new BadGatewayError(
        "Apple authorization service returned an invalid response.",
        {
          provider: "apple",
          status: response.status,
        },
      );
    }
  }

  private toProviderUnavailableError(
    error: unknown,
    operation: string,
  ): ServiceNotAvaliableError {
    return new ServiceNotAvaliableError(
      "Apple authorization service is currently unavailable.",
      {
        provider: "apple",
        operation,
        reason: this.isAbortError(error)
          ? "timeout"
          : (this.readNodeErrorCode(error) ?? "network-error"),
      },
    );
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private readNodeErrorCode(error: unknown): string | undefined {
    const directCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (typeof directCode === "string") {
      return directCode;
    }

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
}

export default AppleOAuthService;
export { AppleOAuthService };
