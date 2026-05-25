import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
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
  context: Context<AppBindings>,
  auth: AuthPrincipal,
): void {
  if (auth.authMethod !== "pat") {
    return;
  }

  const pathname = stripApiRoutePrefix(new URL(context.req.url).pathname);
  const requestMethod = context.req.method ?? "GET";
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

export const jwtMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    await requireJwtAuth(context);
    await next();
  },
);

export async function requireJwtAuth(
  context: Context<AppBindings>,
): Promise<AuthPrincipal> {
  const existingClaims = context.get("auth");

  if (existingClaims) {
    return existingClaims;
  }

  const token = readBearerToken(context.req.header("authorization"));
  const claims = isPersonalAccessToken(token)
    ? await getRequestContainer(context)
        .resolve(containerTokens.personalAccessTokenService)
        .authenticateToken(token)
    : createJwtPrincipal(
        await getRequestContainer(context)
          .resolve(containerTokens.tokenService)
          .verifyAccessToken(token),
      );

  assertPersonalAccessTokenAccess(context, claims);

  context.set("auth", claims);
  return claims;
}

export async function getOptionalJwtAuth(
  context: Context<AppBindings>,
): Promise<AuthPrincipal | null> {
  if (!context.req.header("authorization")) {
    return null;
  }

  return requireJwtAuth(context);
}

export async function requireSessionAuth(
  context: Context<AppBindings>,
): Promise<JwtAuthPrincipal> {
  const auth = await requireJwtAuth(context);

  if (auth.authMethod !== "jwt") {
    throw new ForbiddenError(
      "This endpoint requires a signed-in user session.",
    );
  }

  return auth;
}
