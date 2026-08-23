import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  OrganizationMembershipAccessRecord,
  OrganizationsRepository,
} from "@/features/organizations/organizations.repository";
import type { OrganizationRole } from "@/features/organizations/organizations.model";

/**
 * Loads the full membership+organization record backing a management action
 * (name/slug for emails and responses, role for authorization), as opposed to
 * `OrganizationAccessService`'s simpler role-only lookup used by the
 * sub-domain services (announcements/blog/reviews/comments).
 */
export async function requireOrganizationMembershipAccess(
  organizationsRepository: OrganizationsRepository,
  userId: string,
  organizationId: string,
): Promise<OrganizationMembershipAccessRecord> {
  const membership = await organizationsRepository.findMembershipAccess(
    userId,
    organizationId,
  );

  if (!membership) {
    throw new ResourceNotFoundError("Organization could not be found.");
  }

  return membership;
}

export function requirePrimaryManager(role: OrganizationRole): void {
  if (role !== "primary_manager") {
    throw new ForbiddenError(
      "Only the primary manager can perform this action.",
    );
  }
}
