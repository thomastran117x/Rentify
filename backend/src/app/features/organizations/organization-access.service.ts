import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  AuthUserOrganizationMembershipRecord,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import type { AuthRepository } from "@/features/auth/auth.repository";

export class OrganizationAccessService {
  constructor(private readonly authRepository: AuthRepository) {}

  async requireActiveMembership(
    userId: string,
    errorMessage = "Select or join an organization before continuing.",
  ): Promise<AuthUserOrganizationMembershipRecord> {
    const user = await this.requireUser(userId);
    const membership = this.resolveActiveMembership(user);

    if (!membership) {
      throw new BadRequestError(errorMessage);
    }

    return membership;
  }

  async findMembership(
    userId: string,
    organizationId: string,
  ): Promise<AuthUserOrganizationMembershipRecord | null> {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      return null;
    }

    return (
      user.organizationMemberships.find(
        (membership) => membership.organizationId === organizationId,
      ) ?? null
    );
  }

  async requireMembership(
    userId: string,
    organizationId: string,
    errorMessage = "You do not have access to this organization.",
  ): Promise<AuthUserOrganizationMembershipRecord> {
    const membership = await this.findMembership(userId, organizationId);

    if (!membership) {
      throw new ForbiddenError(errorMessage);
    }

    return membership;
  }

  assertCanManage(
    membership: Pick<AuthUserOrganizationMembershipRecord, "role">,
    errorMessage = "You do not have permission to manage this organization resource.",
  ): void {
    if (this.canManage(membership.role)) {
      return;
    }

    throw new ForbiddenError(errorMessage);
  }

  canManage(role: AuthUserOrganizationMembershipRecord["role"]): boolean {
    return role === "primary_manager" || role === "manager";
  }

  private async requireUser(userId: string): Promise<AuthUserRecord> {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new ResourceNotFoundError("User could not be found.");
    }

    return user;
  }

  private resolveActiveMembership(
    user: AuthUserRecord,
  ): AuthUserOrganizationMembershipRecord | null {
    return (
      user.organizationMemberships.find(
        (membership) =>
          membership.organizationId === user.preferredOrganizationId,
      ) ??
      user.organizationMemberships[0] ??
      null
    );
  }
}
