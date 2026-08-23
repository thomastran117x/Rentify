import type { Request } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import {
  getOptionalJwtAuth,
  requireJwtAuth,
} from "@/configuration/middlewares/jwt-middleware";
import { RequestValidationError } from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import {
  organizationInviteTokenSchema,
  organizationResourceIdSchema,
  organizationSlugPathSchema,
} from "@/features/organizations/organizations.model";
import {
  listPublicOrganizationsQuerySchema,
  type ListPublicOrganizationsInput,
} from "@/features/organizations/profile/profile.model";

export function parseListPublicOrganizationsInput(
  request: Request,
): ListPublicOrganizationsInput {
  const url = getRequestUrl(request);

  try {
    const query = listPublicOrganizationsQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    });

    return {
      page: query.page,
      pageSize: query.pageSize,
      query: query.q,
      sort: query.sort,
    };
  } catch (error) {
    if ("issues" in (error as object)) {
      const issues = (
        error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
      ).issues;

      throw new RequestValidationError(
        "Request query validation failed.",
        (issues ?? []).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}

export function requireRouteValue<TValue extends string>(
  request: Request,
  name: string,
  schema: { parse: (value: string) => TValue },
  message: string,
): TValue {
  const value = requireSafeRouteParam(request, name);

  try {
    return schema.parse(value);
  } catch (error) {
    if ("issues" in (error as object)) {
      const issues =
        (error as { issues?: Array<{ message: string }> }).issues ?? [];

      throw new RequestValidationError(
        message,
        issues.map((issue) => ({
          path: name,
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}

export function requireResourceId(request: Request, name: string): string {
  return requireRouteValue(
    request,
    name,
    organizationResourceIdSchema,
    "Route parameter validation failed.",
  );
}

export function requireOrganizationId(request: Request): string {
  return requireResourceId(request, "id");
}

/**
 * Reads the slug from /organizations/by-slug/:slug.
 *
 * Validates the canonical form without normalizing, so a non-canonical
 * reference (uppercase, trailing hyphen) is rejected here rather than served
 * at a non-canonical URL. Callers normalize before requesting.
 */
export function requireOrganizationSlug(request: Request): string {
  return requireRouteValue(
    request,
    "slug",
    organizationSlugPathSchema,
    "Route parameter validation failed.",
  );
}

export function requireInviteToken(request: Request): string {
  return requireRouteValue(
    request,
    "token",
    organizationInviteTokenSchema,
    "Route parameter validation failed.",
  );
}

export async function requireAuth(request: Request): Promise<AuthPrincipal> {
  return requireJwtAuth(request);
}

export async function getOptionalAuth(
  request: Request,
): Promise<AuthPrincipal | null> {
  return getOptionalJwtAuth(request);
}
