import { getOptionalEnvironmentVariable } from "@/configuration/environment";
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

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_JWKS_ALLOWED_HOSTS = ["www.googleapis.com"];
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_ALLOWED_HOSTS = ["oauth2.googleapis.com"];
const GOOGLE_TOKEN_TIMEOUT_MS = 5_000;

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

function readAudiences(): string[] {
  const value =
    getOptionalEnvironmentVariable("GOOGLE_OAUTH_CLIENT_IDS") ??
    getOptionalEnvironmentVariable("GOOGLE_OAUTH_CLIENT_ID");

  if (!value) {
    throw new BadRequestError("Google OAuth is not configured.");
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readPrimaryClientId(): string {
  const [clientId] = readAudiences();

  if (!clientId) {
    throw new BadRequestError("Google OAuth is not configured.");
  }

  return clientId;
}

function readClientSecret(): string | undefined {
  return getOptionalEnvironmentVariable("GOOGLE_OAUTH_CLIENT_SECRET");
}

function readFrontendBaseUrl(): string {
  return (
    getOptionalEnvironmentVariable("FRONTEND_URL") ??
    getOptionalEnvironmentVariable("APP_BASE_URL") ??
    "http://localhost:3040"
  ).replace(/\/+$/, "");
}

function normalizeEmailVerified(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

class GoogleOAuthService {
  constructor(private readonly tokenVerifier: OAuthTokenVerifier) {}

  async verify(input: OAuthAuthenticateInput): Promise<VerifiedOAuthProfile> {
    const idToken = await this.exchangeCodeForIdToken(input);
    const payload = await this.tokenVerifier.verifyIdToken(idToken, {
      issuer: GOOGLE_ISSUERS,
      audience: readAudiences(),
      jwksUrl: GOOGLE_JWKS_URL,
      allowedHosts: GOOGLE_JWKS_ALLOWED_HOSTS,
      nonce: input.nonce,
    });

    if (!payload.sub || typeof payload.email !== "string") {
      throw new UnauthorizedError(
        "Google ID token is missing required claims.",
      );
    }

    const emailVerified = normalizeEmailVerified(payload.email_verified);

    if (!emailVerified) {
      throw new UnauthorizedError("Google account email is not verified.");
    }

    return {
      provider: "google",
      providerUserId: payload.sub,
      email: payload.email.trim().toLowerCase(),
      emailVerified,
      firstName:
        input.firstName ??
        (typeof payload.given_name === "string"
          ? payload.given_name.trim() || undefined
          : undefined),
      lastName:
        input.lastName ??
        (typeof payload.family_name === "string"
          ? payload.family_name.trim() || undefined
          : undefined),
    };
  }

  private async exchangeCodeForIdToken(
    input: OAuthAuthenticateInput,
  ): Promise<string> {
    if (!input.code || !input.codeVerifier) {
      throw new BadRequestError(
        "Google authorization code exchange is missing PKCE inputs.",
      );
    }

    const body = new URLSearchParams({
      code: input.code,
      client_id: readPrimaryClientId(),
      redirect_uri: `${readFrontendBaseUrl()}/auth/google`,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    });
    const clientSecret = readClientSecret();

    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      GOOGLE_TOKEN_TIMEOUT_MS,
    );
    let response: Response;

    try {
      response = await fetch(
        assertTrustedOutboundUrl(GOOGLE_TOKEN_URL, {
          allowedHosts: GOOGLE_TOKEN_ALLOWED_HOSTS,
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
        "Google authorization service is currently unavailable.",
        {
          provider: "google",
          status: response.status,
          reason: payload.error ?? "provider-server-error",
        },
      );
    }

    if (!response.ok) {
      throw new UnauthorizedError(
        payload.error_description ||
          payload.error ||
          "Google authorization code exchange failed.",
      );
    }

    if (!payload.id_token) {
      throw new UnauthorizedError(
        "Google token response did not include an ID token.",
      );
    }

    return payload.id_token;
  }

  private async readTokenResponse(
    response: Response,
  ): Promise<GoogleTokenResponse> {
    try {
      return (await response.json()) as GoogleTokenResponse;
    } catch {
      throw new BadGatewayError(
        "Google authorization service returned an invalid response.",
        {
          provider: "google",
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
      "Google authorization service is currently unavailable.",
      {
        provider: "google",
        operation,
        reason: this.isAbortError(error)
          ? "timeout"
          : this.readNodeErrorCode(error) ?? "network-error",
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

export default GoogleOAuthService;
export { GoogleOAuthService };
