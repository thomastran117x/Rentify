import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import type { OrganizationRole } from "@/features/organizations/organizations.model";

/**
 * Which role an actor may invite (or restore an invitation for). Pure so it
 * can be shared by `invitations/invitations.service.ts` (creating an
 * invitation) and `audit/audit.service.ts` (restoring one) without either
 * depending on the other.
 */
export function assertCanInvite(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
): void {
  if (targetRole === "primary_manager") {
    throw new BadRequestError(
      "Primary manager invitations are not supported in this release.",
    );
  }

  if (actorRole === "primary_manager") {
    return;
  }

  if (actorRole === "manager" && targetRole === "operator") {
    return;
  }

  throw new ForbiddenError("You do not have permission to invite that role.");
}
