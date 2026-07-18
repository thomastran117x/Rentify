import type {
  ActiveOrganizationSummary,
  AuthResponseUser,
} from "@/lib/auth/types";
import type { OrganizationRole } from "@/lib/organizations/api";

export type AppUserRole = AuthResponseUser["role"];

export function isOwnerRole(role?: AppUserRole): boolean {
  return role === "owner" || role === "admin";
}

export function isModeratorRole(role?: AppUserRole): boolean {
  return role === "moderator" || role === "admin";
}

export function isMarketplaceUserRole(role?: AppUserRole): boolean {
  return role === "user" || isOwnerRole(role) || isModeratorRole(role);
}

export function canManageOrganizationPostings(
  organization?: ActiveOrganizationSummary,
): boolean {
  return (
    organization?.role === "primary_manager" || organization?.role === "manager"
  );
}

export function canReadOrganizationPostings(
  organization?: ActiveOrganizationSummary,
): boolean {
  return Boolean(organization);
}

// Organization-scoped role predicates. `primary_manager` is effectively the
// owner; `operator` is the least-privileged member.
export function canInviteOrganizationMembers(role?: OrganizationRole): boolean {
  return role === "primary_manager" || role === "manager";
}

export function canSeeOrganizationActivity(role?: OrganizationRole): boolean {
  return role === "primary_manager" || role === "manager";
}

export function canManageOrganizationContent(role?: OrganizationRole): boolean {
  return role === "primary_manager" || role === "manager";
}

export function canEditOrganizationSettings(role?: OrganizationRole): boolean {
  return role === "primary_manager";
}
