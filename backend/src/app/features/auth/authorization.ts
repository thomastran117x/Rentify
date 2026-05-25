import ForbiddenError from "@/errors/http/forbidden.error";
import type { AppRole } from "@/features/auth/auth.model";
import { normalizeAppRole } from "@/features/auth/auth.model";
import type { AuthPrincipal } from "@/features/auth/auth.principal";

const APP_ROLE_RANK: Record<AppRole, number> = {
  user: 0,
  owner: 1,
  admin: 2,
};

export function getAuthRole(auth: Pick<AuthPrincipal, "role">): AppRole {
  return normalizeAppRole(auth.role);
}

export function hasMinimumRole(
  auth: Pick<AuthPrincipal, "role">,
  minimumRole: AppRole,
): boolean {
  return APP_ROLE_RANK[getAuthRole(auth)] >= APP_ROLE_RANK[minimumRole];
}

export function requireMinimumRole(
  auth: Pick<AuthPrincipal, "role">,
  minimumRole: AppRole,
  message = "You do not have permission to perform this action.",
): AppRole {
  const role = getAuthRole(auth);

  if (APP_ROLE_RANK[role] < APP_ROLE_RANK[minimumRole]) {
    throw new ForbiddenError(message, {
      requiredRole: minimumRole,
      role,
    });
  }

  return role;
}
