import ForbiddenError from "@/errors/http/forbidden.error";
import type { AppRole } from "@/features/auth/auth.model";
import { normalizeAppRole } from "@/features/auth/auth.model";
import type { AuthPrincipal } from "@/features/auth/auth.principal";

const MINIMUM_ROLE_ACCESS: Record<AppRole, AppRole[]> = {
  user: ["user", "owner", "moderator", "admin"],
  owner: ["owner", "admin"],
  moderator: ["moderator", "admin"],
  admin: ["admin"],
};

export function getAuthRole(auth: Pick<AuthPrincipal, "role">): AppRole {
  return normalizeAppRole(auth.role);
}

export function hasMinimumRole(
  auth: Pick<AuthPrincipal, "role">,
  minimumRole: AppRole,
): boolean {
  return MINIMUM_ROLE_ACCESS[minimumRole].includes(getAuthRole(auth));
}

export function requireMinimumRole(
  auth: Pick<AuthPrincipal, "role">,
  minimumRole: AppRole,
  message = "You do not have permission to perform this action.",
): AppRole {
  const role = getAuthRole(auth);

  if (!hasMinimumRole(auth, minimumRole)) {
    throw new ForbiddenError(message, {
      requiredRole: minimumRole,
      role,
    });
  }

  return role;
}

export function hasAnyRole(
  auth: Pick<AuthPrincipal, "role">,
  roles: AppRole[],
): boolean {
  return roles.includes(getAuthRole(auth));
}

export function requireAnyRole(
  auth: Pick<AuthPrincipal, "role">,
  roles: AppRole[],
  message = "You do not have permission to perform this action.",
): AppRole {
  const role = getAuthRole(auth);

  if (!roles.includes(role)) {
    throw new ForbiddenError(message, {
      allowedRoles: roles,
      role,
    });
  }

  return role;
}
