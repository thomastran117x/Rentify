import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import { requireExistingUser } from "@/features/organizations/require-existing-user";
import {
  requireOrganizationMembershipAccess,
  requirePrimaryManager,
} from "@/features/organizations/organization-membership-access";
import { createChanges } from "@/features/organizations/organization-audit-changes";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import type {
  OrganizationMemberRecord,
  OrganizationMembershipSummary,
  OrganizationRole,
  OrganizationSummary,
} from "@/features/organizations/organizations.model";
import type { OrganizationsMembersRepository } from "@/features/organizations/members/members.repository";
import type { OrganizationsProfileRepository } from "@/features/organizations/profile/profile.repository";
import type {
  RemoveOrganizationMemberInput,
  SetActiveOrganizationInput,
  SetActiveOrganizationResult,
  UpdateOrganizationMemberInput,
} from "@/features/organizations/members/members.model";
import type { OrganizationWorkspaceResult } from "@/features/organizations/profile/profile.model";

export class OrganizationMembersService {
  constructor(
    private readonly organizationsMembersRepository: OrganizationsMembersRepository,
    private readonly organizationsProfileRepository: OrganizationsProfileRepository,
    private readonly usersRepository: UsersRepository,
    private readonly organizationAuditService: OrganizationAuditService,
  ) {}

  async listMine(userId: string): Promise<OrganizationWorkspaceResult> {
    const user = await requireExistingUser(this.usersRepository, userId);
    const memberships =
      await this.organizationsMembersRepository.listMembershipsByUserId(
        user.id,
        user.preferredOrganizationId,
      );

    return {
      memberships,
      activeOrganization: this.resolveActiveOrganization(memberships),
    };
  }

  async setActiveOrganization(
    input: SetActiveOrganizationInput,
  ): Promise<SetActiveOrganizationResult> {
    const membership = await requireOrganizationMembershipAccess(
      this.organizationsMembersRepository,
      input.userId,
      input.organizationId,
    );
    await this.organizationsProfileRepository.setPreferredOrganization(
      input.userId,
      input.organizationId,
    );

    return {
      activeOrganization: {
        id: membership.organization.id,
        slug: membership.organization.slug,
        name: membership.organization.name,
        role: membership.role,
      },
    };
  }

  async updateMemberRole(
    input: UpdateOrganizationMemberInput,
  ): Promise<{ member: OrganizationMemberRecord }> {
    const actorMembership = await requireOrganizationMembershipAccess(
      this.organizationsMembersRepository,
      input.actorUserId,
      input.organizationId,
    );
    const targetMember = await this.requireMember(
      input.organizationId,
      input.membershipId,
    );

    this.assertCanUpdateMemberRole(actorMembership, targetMember, input.role);

    const updated = await this.organizationsMembersRepository.updateMembershipRole(
      targetMember.membershipId,
      input.role,
    );

    await this.organizationAuditService.recordSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "member.role_updated",
      resourceType: "member",
      resourceId: targetMember.membershipId,
      summary: `${targetMember.username} changed from ${targetMember.role} to ${updated.role}.`,
      changes: createChanges(targetMember, updated, ["role"]),
      beforeSnapshot: targetMember,
      afterSnapshot: updated,
      restorable: true,
    });

    return {
      member: updated,
    };
  }

  async removeMember(
    input: RemoveOrganizationMemberInput,
  ): Promise<{ removed: true; membershipId: string }> {
    const actorMembership = await requireOrganizationMembershipAccess(
      this.organizationsMembersRepository,
      input.actorUserId,
      input.organizationId,
    );
    const targetMember = await this.requireMember(
      input.organizationId,
      input.membershipId,
    );

    this.assertCanRemoveMember(actorMembership, targetMember);

    const removed = await this.organizationsMembersRepository.removeMembership(
      targetMember.membershipId,
    );

    if (!removed) {
      throw new ConflictError("This member could not be removed.");
    }

    const targetUser = await requireExistingUser(
      this.usersRepository,
      targetMember.userId,
    );

    if (targetUser.preferredOrganizationId === input.organizationId) {
      await this.organizationsProfileRepository.setPreferredOrganization(
        targetMember.userId,
        null,
      );
    }

    await this.organizationAuditService.recordSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "member.removed",
      resourceType: "member",
      resourceId: targetMember.membershipId,
      summary: `${targetMember.username} was removed from the organization.`,
      changes: createChanges(targetMember, null),
      beforeSnapshot: targetMember,
      afterSnapshot: null,
      restorable: true,
    });

    return {
      removed: true,
      membershipId: targetMember.membershipId,
    };
  }

  private async requireMember(
    organizationId: string,
    membershipId: string,
  ): Promise<OrganizationMemberRecord> {
    const member = await this.organizationsMembersRepository.findMemberById(
      organizationId,
      membershipId,
    );

    if (!member) {
      throw new ResourceNotFoundError(
        "Organization member could not be found.",
      );
    }

    return member;
  }

  private assertCanUpdateMemberRole(
    actorMembership: { membershipId: string; role: OrganizationRole },
    targetMember: OrganizationMemberRecord,
    nextRole: OrganizationRole,
  ): void {
    requirePrimaryManager(actorMembership.role);

    if (targetMember.membershipId === actorMembership.membershipId) {
      throw new BadRequestError(
        "Primary manager role changes are not supported in this release.",
      );
    }

    if (
      targetMember.role === "primary_manager" ||
      nextRole === "primary_manager"
    ) {
      throw new BadRequestError(
        "Primary manager transfer is not supported in this release.",
      );
    }
  }

  private assertCanRemoveMember(
    actorMembership: { membershipId: string; role: OrganizationRole },
    targetMember: OrganizationMemberRecord,
  ): void {
    if (targetMember.membershipId === actorMembership.membershipId) {
      throw new BadRequestError(
        "You cannot remove your own organization membership.",
      );
    }

    if (actorMembership.role === "primary_manager") {
      if (targetMember.role === "primary_manager") {
        throw new BadRequestError(
          "Primary manager transfer is not supported in this release.",
        );
      }

      return;
    }

    if (
      actorMembership.role === "manager" &&
      targetMember.role === "operator"
    ) {
      return;
    }

    throw new ForbiddenError(
      "You do not have permission to remove this member.",
    );
  }

  private resolveActiveOrganization(
    memberships: OrganizationMembershipSummary[],
  ): OrganizationSummary | undefined {
    const activeMembership =
      memberships.find((membership) => membership.isActive) ?? memberships[0];

    if (!activeMembership) {
      return undefined;
    }

    return {
      id: activeMembership.id,
      slug: activeMembership.slug,
      name: activeMembership.name,
      role: activeMembership.role,
    };
  }
}
