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

const MICROSOFT_JWKS_ALLOWED_HOSTS = ["login.microsoftonline.com"];
const MICROSOFT_TOKEN_ALLOWED_HOSTS = ["login.microsoftonline.com"];
const MICROSOFT_TOKEN_TIMEOUT_MS = 5_000;

interface MicrosoftTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

function readAudiences(): string[] {
  const value =
    getOptionalEnvironmentVariable("MICROSOFT_OAUTH_CLIENT_IDS") ??
    getOptionalEnvironmentVariable("MICROSOFT_OAUTH_CLIENT_ID");

  if (!value) {
    throw new BadRequestError("Microsoft OAuth is not configured.");
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readPrimaryClientId(): string {
  const [clientId] = readAudiences();

  if (!clientId) {
    throw new BadRequestError("Microsoft OAuth is not configured.");
  }

  return clientId;
}

function readClientSecret(): string | undefined {
  return getOptionalEnvironmentVariable("MICROSOFT_OAUTH_CLIENT_SECRET");
}

function readTenant(): string {
  return (
    getOptionalEnvironmentVariable("MICROSOFT_OAUTH_TENANT")?.trim() ||
    "consumers"
  );
}

function buildJwksUrl(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
}

function buildAllowedIssuers(tenant: string): string[] {
  if (tenant === "common") {
    return [
      "https://login.microsoftonline.com/common/v2.0",
      "https://login.microsoftonline.com/consumers/v2.0",
      "https://login.microsoftonline.com/organizations/v2.0",
    ];
  }

  return [`https://login.microsoftonline.com/${tenant}/v2.0`];
}

function readFrontendBaseUrl(): string {
  return (
    getOptionalEnvironmentVariable("FRONTEND_URL") ??
    getOptionalEnvironmentVariable("APP_BASE_URL") ??
    "http://localhost:3040"
  ).replace(/\/+$/, "");
}

function splitName(name?: string): { firstName?: string; lastName?: string } {
  if (!name) {
    return {};
  }

  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return {};
  }

  const [firstName, ...rest] = parts;
  return {
    firstName,
    lastName: rest.length ? rest.join(" ") : undefined,
  };
}

function normalizeEmailVerified(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

class MicrosoftOAuthService {
  constructor(private readonly tokenVerifier: OAuthTokenVerifier) {}

  async verify(input: OAuthAuthenticateInput): Promise<VerifiedOAuthProfile> {
    const tenant = readTenant();
    const idToken = input.idToken ?? (await this.exchangeCodeForIdToken(input));
    const payload = await this.tokenVerifier.verifyIdToken(idToken, {
      issuer: buildAllowedIssuers(tenant),
      audience: readAudiences(),
      jwksUrl: buildJwksUrl(tenant),
      allowedHosts: MICROSOFT_JWKS_ALLOWED_HOSTS,
      nonce: input.nonce,
    });

    const emailClaim =
      typeof payload.email === "string" ? payload.email : undefined;

    if (!payload.sub || !emailClaim) {
      throw new UnauthorizedError(
        "Microsoft ID token is missing required claims.",
      );
    }

    const emailVerified =
      payload.email_verified === undefined
        ? true
        : normalizeEmailVerified(payload.email_verified);

    if (!emailVerified) {
      throw new UnauthorizedError("Microsoft account email is not verified.");
    }

    const tokenNames = splitName(
      typeof payload.name === "string" ? payload.name : undefined,
    );

    return {
      provider: "microsoft",
      providerUserId: payload.sub,
      email: emailClaim.trim().toLowerCase(),
      emailVerified,
      firstName: input.firstName ?? tokenNames.firstName,
      lastName: input.lastName ?? tokenNames.lastName,
    };
  }

  private async exchangeCodeForIdToken(
    input: OAuthAuthenticateInput,
  ): Promise<string> {
    if (!input.code || !input.codeVerifier) {
      throw new BadRequestError(
        "Microsoft authorization code exchange is missing PKCE inputs.",
      );
    }

    const tenant = readTenant();
    const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      code: input.code,
      client_id: readPrimaryClientId(),
      redirect_uri: `${readFrontendBaseUrl()}/auth/microsoft`,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
      scope: "openid email profile",
    });
    const clientSecret = readClientSecret();

    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      MICROSOFT_TOKEN_TIMEOUT_MS,
    );
    let response: Response;

    try {
      response = await fetch(
        assertTrustedOutboundUrl(tokenUrl, {
          allowedHosts: MICROSOFT_TOKEN_ALLOWED_HOSTS,
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
        "Microsoft authorization service is currently unavailable.",
        {
          provider: "microsoft",
          status: response.status,
          reason: payload.error ?? "provider-server-error",
        },
      );
    }

    if (!response.ok) {
      throw new UnauthorizedError(
        payload.error_description ||
          payload.error ||
          "Microsoft authorization code exchange failed.",
      );
    }

    if (!payload.id_token) {
      throw new UnauthorizedError(
        "Microsoft token response did not include an ID token.",
      );
    }

    return payload.id_token;
  }

  private async readTokenResponse(
    response: Response,
  ): Promise<MicrosoftTokenResponse> {
    try {
      return (await response.json()) as MicrosoftTokenResponse;
    } catch {
      throw new BadGatewayError(
        "Microsoft authorization service returned an invalid response.",
        {
          provider: "microsoft",
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
      "Microsoft authorization service is currently unavailable.",
      {
        provider: "microsoft",
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

export default MicrosoftOAuthService;
export { MicrosoftOAuthService };
