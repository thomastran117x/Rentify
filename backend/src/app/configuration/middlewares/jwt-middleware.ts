import type { Request, RequestHandler } from "express";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
import { getHeader, getPathname } from "@/configuration/http/request";
import ForbiddenError from "@/errors/http/forbidden.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { JwtClaims } from "@/features/auth/token/token.service";
import type {
  AuthPrincipal,
  JwtAuthPrincipal,
} from "@/features/auth/auth.principal";

function readBearerToken(headerValue?: string): string {
  if (!headerValue) {
    throw new UnauthorizedError("Authorization header is required.");
  }

  const [scheme, token] = headerValue.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new UnauthorizedError(
      "Authorization header must use the Bearer scheme.",
    );
  }

  return token;
}

function isPersonalAccessToken(token: string): boolean {
  return token.startsWith("rpat_");
}

function createJwtPrincipal(claims: JwtClaims): JwtAuthPrincipal {
  return {
    ...claims,
    authMethod: "jwt",
  };
}

type PatRoutePolicy = {
  method: string;
  pattern: RegExp;
  requiredScope: "mcp:read" | "mcp:write";
};

const PAT_ROUTE_POLICIES: PatRoutePolicy[] = [
  { method: "GET", pattern: /^\/profile\/me$/, requiredScope: "mcp:read" },
  { method: "GET", pattern: /^\/postings$/, requiredScope: "mcp:read" },
  {
    method: "GET",
    pattern: /^\/postings\/autocomplete$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/postings\/recommendations$/,
    requiredScope: "mcp:read",
  },
  { method: "GET", pattern: /^\/postings\/batch$/, requiredScope: "mcp:read" },
  { method: "GET", pattern: /^\/postings\/me$/, requiredScope: "mcp:read" },
  {
    method: "GET",
    pattern: /^\/postings\/me\/batch$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/postings\/analytics\/summary$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/postings\/analytics\/postings$/,
    requiredScope: "mcp:read",
  },
  // Listed explicitly ahead of the /postings/:id catch-all below. The
  // catch-all would already match /postings/saved by accident; being explicit
  // documents the intent and survives any future narrowing of that pattern.
  { method: "GET", pattern: /^\/postings\/saved$/, requiredScope: "mcp:read" },
  {
    method: "GET",
    pattern: /^\/postings\/saved\/ids$/,
    requiredScope: "mcp:read",
  },
  // Two segments deep, so the /postings/:id catch-all below does not reach it
  // and an omission here would 403 a valid PAT against a contract that
  // advertises jwt-or-pat.
  {
    method: "GET",
    pattern: /^\/postings\/saved\/searches$/,
    requiredScope: "mcp:read",
  },
  { method: "GET", pattern: /^\/postings\/[^/]+$/, requiredScope: "mcp:read" },
  {
    method: "GET",
    pattern: /^\/postings\/[^/]+\/analytics$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/postings\/[^/]+\/reviews$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/postings\/[^/]+\/availability-blocks$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/postings\/[^/]+\/booking-requests$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/booking-requests\/me$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/booking-requests\/me\/dashboard$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/booking-requests\/owner$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/booking-requests\/owner\/dashboard$/,
    requiredScope: "mcp:read",
  },
  {
    method: "GET",
    pattern: /^\/booking-requests\/[^/]+$/,
    requiredScope: "mcp:read",
  },
  { method: "GET", pattern: /^\/payouts\/me$/, requiredScope: "mcp:read" },
  { method: "GET", pattern: /^\/rentings\/me$/, requiredScope: "mcp:read" },
  { method: "GET", pattern: /^\/rentings\/[^/]+$/, requiredScope: "mcp:read" },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/booking-quote$/,
    requiredScope: "mcp:read",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/activity\/search-click$/,
    requiredScope: "mcp:read",
  },
  { method: "POST", pattern: /^\/postings$/, requiredScope: "mcp:write" },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/booking-requests$/,
    requiredScope: "mcp:write",
  },
  { method: "PUT", pattern: /^\/postings\/[^/]+$/, requiredScope: "mcp:write" },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/duplicate$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/publish$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/pause$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/unpause$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/archive$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/availability-blocks$/,
    requiredScope: "mcp:write",
  },
  {
    method: "PUT",
    pattern: /^\/postings\/[^/]+\/availability-blocks\/[^/]+$/,
    requiredScope: "mcp:write",
  },
  {
    method: "DELETE",
    pattern: /^\/postings\/[^/]+\/availability-blocks\/[^/]+$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/postings\/[^/]+\/reviews$/,
    requiredScope: "mcp:write",
  },
  {
    method: "PUT",
    pattern: /^\/postings\/[^/]+\/reviews\/me$/,
    requiredScope: "mcp:write",
  },
  {
    method: "PUT",
    pattern: /^\/booking-requests\/[^/]+$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/booking-requests\/[^/]+\/approve$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/booking-requests\/[^/]+\/decline$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/booking-requests\/[^/]+\/convert$/,
    requiredScope: "mcp:write",
  },
  {
    method: "PUT",
    pattern: /^\/rentings\/[^/]+\/instructions$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/rentings\/[^/]+\/check-in-ready$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/rentings\/[^/]+\/check-in$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/rentings\/[^/]+\/return$/,
    requiredScope: "mcp:write",
  },
  {
    method: "POST",
    pattern: /^\/rentings\/[^/]+\/disputes$/,
    requiredScope: "mcp:write",
  },
];

function assertPersonalAccessTokenAccess(
  request: Request,
  auth: AuthPrincipal,
): void {
  if (auth.authMethod !== "pat") {
    return;
  }

  const pathname = stripApiRoutePrefix(getPathname(request));
  const requestMethod = request.method ?? "GET";
  const policy = PAT_ROUTE_POLICIES.find(
    (entry) => entry.method === requestMethod && entry.pattern.test(pathname),
  );

  if (!policy) {
    throw new ForbiddenError(
      "Personal access tokens cannot access this endpoint.",
      {
        method: requestMethod,
        pathname,
        authMethod: auth.authMethod,
      },
    );
  }

  if (!auth.scopes.includes(policy.requiredScope)) {
    throw new ForbiddenError(
      "Personal access token does not include the required scope.",
      {
        requiredScope: policy.requiredScope,
        scopes: auth.scopes,
      },
    );
  }
}

export const jwtMiddleware: RequestHandler = async (
  request,
  _response,
  next,
) => {
  try {
    await requireJwtAuth(request);
    next();
  } catch (error) {
    next(error);
  }
};

export async function requireJwtAuth(request: Request): Promise<AuthPrincipal> {
  const existingClaims = request.auth;

  if (existingClaims) {
    return existingClaims;
  }

  const token = readBearerToken(getHeader(request, "authorization"));
  const claims = isPersonalAccessToken(token)
    ? await getRequestContainer(request)
        .resolve(containerTokens.personalAccessTokenService)
        .authenticateToken(token)
    : createJwtPrincipal(
        await getRequestContainer(request)
          .resolve(containerTokens.tokenService)
          .verifyAccessToken(token),
      );

  assertPersonalAccessTokenAccess(request, claims);

  request.auth = claims;
  return claims;
}

export async function getOptionalJwtAuth(
  request: Request,
): Promise<AuthPrincipal | null> {
  if (!getHeader(request, "authorization")) {
    return null;
  }

  return requireJwtAuth(request);
}

export async function requireSessionAuth(
  request: Request,
): Promise<JwtAuthPrincipal> {
  const auth = await requireJwtAuth(request);

  if (auth.authMethod !== "jwt") {
    throw new ForbiddenError(
      "This endpoint requires a signed-in user session.",
    );
  }

  return auth;
}
