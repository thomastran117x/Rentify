import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { EmailService } from "@/features/email/email.service";
import { requireExistingUser } from "@/features/organizations/require-existing-user";
import { requireOrganizationMembershipAccess } from "@/features/organizations/organization-membership-access";
import { assertCanInvite } from "@/features/organizations/organization-invite-authorization";
import { createChanges } from "@/features/organizations/organization-audit-changes";
import {
  createInviteToken,
  hashInviteToken,
} from "@/features/organizations/organization-invite-token";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import {
  normalizeOrganizationInvitationEmail,
  type OrganizationRole,
} from "@/features/organizations/organizations.model";
import type {
  OrganizationInviteAccessRecord,
  OrganizationsInvitationsRepository,
} from "@/features/organizations/invitations/invitations.repository";
import type { OrganizationsMembersRepository } from "@/features/organizations/members/members.repository";
import type { OrganizationsProfileRepository } from "@/features/organizations/profile/profile.repository";
import type {
  AcceptOrganizationInviteInput,
  AcceptOrganizationInviteResult,
  CreateOrganizationInviteInput,
  CreateOrganizationInviteResult,
  OrganizationInvitePreviewResult,
  PreviewOrganizationInviteInput,
  RevokeOrganizationInviteInput,
} from "@/features/organizations/invitations/invitations.model";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

const ORGANIZATION_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class OrganizationInvitationsService {
  constructor(
    private readonly organizationsInvitationsRepository: OrganizationsInvitationsRepository,
    private readonly organizationsMembersRepository: OrganizationsMembersRepository,
    private readonly organizationsProfileRepository: OrganizationsProfileRepository,
    private readonly usersRepository: UsersRepository,
    private readonly emailService: EmailService,
    private readonly organizationAuditService: OrganizationAuditService,
  ) {}

  async createInvitation(
    input: CreateOrganizationInviteInput,
  ): Promise<CreateOrganizationInviteResult> {
    const membership = await requireOrganizationMembershipAccess(
      this.organizationsMembersRepository,
      input.actorUserId,
      input.organizationId,
    );
    const email = normalizeOrganizationInvitationEmail(input.email);
    assertCanInvite(membership.role, input.role);

    const existingMember =
      await this.organizationsMembersRepository.findMemberByEmail(
        input.organizationId,
        email,
      );

    if (existingMember) {
      throw new ConflictError(
        "That user is already a member of this organization.",
      );
    }

    const token = createInviteToken();
    const invitation =
      await this.organizationsInvitationsRepository.reissueInvitation({
        organizationId: input.organizationId,
        invitedByUserId: input.actorUserId,
        email,
        role: input.role,
        tokenHash: hashInviteToken(token),
        expiresAt: new Date(Date.now() + ORGANIZATION_INVITE_TTL_MS),
        now: new Date(),
      });

    await this.emailService.sendOrganizationInviteEmail({
      to: email,
      organizationName: membership.organization.name,
      inviterName: invitation.invitedBy.username,
      role: input.role,
      token,
    });

    await this.organizationAuditService.recordSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "invitation.created",
      resourceType: "invitation",
      resourceId: invitation.id,
      summary: `${invitation.emailHint} was invited as ${input.role}.`,
      changes: createChanges(null, invitation),
      afterSnapshot: invitation,
      restorable: false,
    });

    return {
      invitation,
    };
  }

  async revokeInvitation(
    input: RevokeOrganizationInviteInput,
  ): Promise<CreateOrganizationInviteResult> {
    const membership = await requireOrganizationMembershipAccess(
      this.organizationsMembersRepository,
      input.actorUserId,
      input.organizationId,
    );
    let invitation = await this.requireInvitation(
      input.organizationId,
      input.invitationId,
    );

    invitation = await this.ensureInvitationExpiry(invitation);
    this.assertCanRevokeInvitation(membership.role, invitation);

    const revoked =
      await this.organizationsInvitationsRepository.revokeInvitation(
        asUuid(invitation.id),
        new Date(),
      );

    if (!revoked) {
      throw new ConflictError("This invitation can no longer be revoked.");
    }

    await this.organizationAuditService.recordSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: revoked.id,
      summary: `${revoked.emailHint} invitation was revoked.`,
      changes: createChanges(invitation, revoked, ["status", "revokedAt"]),
      beforeSnapshot: invitation,
      afterSnapshot: revoked,
      restorable: true,
    });

    return {
      invitation: revoked,
    };
  }

  async previewInvitation(
    input: PreviewOrganizationInviteInput,
  ): Promise<OrganizationInvitePreviewResult> {
    let invitation = await this.requireInvitationByToken(input.token);
    invitation = await this.ensureInvitationExpiry(invitation);

    const user = input.userId
      ? await this.usersRepository.findUserById(input.userId)
      : null;
    const normalizedViewerEmail = user?.email?.trim().toLowerCase();
    const matchesEmail =
      typeof normalizedViewerEmail === "string" &&
      normalizedViewerEmail === invitation.email;

    return {
      invitation: {
        organizationId: asUuid(invitation.organization.id),
        organizationName: invitation.organization.name,
        emailHint: invitation.emailHint,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
      viewer: {
        authenticated: Boolean(user),
        email: user?.email,
        emailVerified: user?.emailVerified,
        matchesEmail,
        canAccept:
          Boolean(user?.emailVerified) &&
          matchesEmail &&
          invitation.status === "pending",
      },
    };
  }

  async acceptInvitation(
    input: AcceptOrganizationInviteInput,
  ): Promise<AcceptOrganizationInviteResult> {
    const user = await requireExistingUser(this.usersRepository, input.userId);

    if (!user.emailVerified) {
      throw new ForbiddenError(
        "Verify your email address before accepting this invitation.",
      );
    }

    let invitation = await this.requireInvitationByToken(input.token);
    invitation = await this.ensureInvitationExpiry(invitation);

    if (normalizeOrganizationInvitationEmail(user.email) !== invitation.email) {
      throw new ForbiddenError(
        "This invitation is for a different email address.",
      );
    }

    if (invitation.status === "accepted") {
      const existingMember =
        await this.organizationsMembersRepository.findMemberByUserId(
          asUuid(invitation.organization.id),
          user.id,
        );

      if (!existingMember) {
        throw new ConflictError(
          "This invitation was already accepted, but the membership record is missing.",
        );
      }

      const memberships =
        await this.organizationsMembersRepository.listMembershipsByUserId(
          asUuid(user.id),
          user.preferredOrganizationId,
        );
      const membership = memberships.find(
        (entry) => entry.membershipId === existingMember.membershipId,
      );

      if (!membership) {
        throw new ConflictError(
          "This organization membership could not be found.",
        );
      }

      return {
        accepted: true,
        organization: {
          id: invitation.organization.id,
          slug: invitation.organization.slug,
          name: invitation.organization.name,
          role: membership.role,
        },
        membership,
      };
    }

    if (invitation.status !== "pending") {
      throw new BadRequestError("This invitation can no longer be accepted.");
    }

    const { invitation: acceptedInvitation, membership } =
      await this.organizationsInvitationsRepository.acceptInvitation({
        invitationId: asUuid(invitation.id),
        organizationId: asUuid(invitation.organization.id),
        userId: asUuid(user.id),
        role: invitation.role,
        now: new Date(),
      });

    if (!user.preferredOrganizationId) {
      await this.organizationsProfileRepository.setPreferredOrganization(
        asUuid(user.id),
        invitation.organization.id,
      );
    }

    const memberships =
      await this.organizationsMembersRepository.listMembershipsByUserId(
        asUuid(user.id),
        user.preferredOrganizationId ?? invitation.organization.id,
      );
    const membershipSummary = memberships.find(
      (entry) => entry.membershipId === membership.membershipId,
    );

    if (!membershipSummary) {
      throw new ConflictError(
        "This organization membership could not be found.",
      );
    }

    await this.organizationAuditService.recordSafely({
      organizationId: asUuid(invitation.organization.id),
      actorUserId: asUuid(user.id),
      action: "invitation.accepted",
      resourceType: "invitation",
      resourceId: acceptedInvitation.id,
      summary: `${acceptedInvitation.emailHint} invitation was accepted.`,
      changes: createChanges(invitation, acceptedInvitation),
      beforeSnapshot: invitation,
      afterSnapshot: acceptedInvitation,
      restorable: false,
    });

    return {
      accepted: true,
      organization: {
        id: invitation.organization.id,
        slug: invitation.organization.slug,
        name: invitation.organization.name,
        role: membership.role,
      },
      membership: membershipSummary,
    };
  }

  /**
   * Expires any pending invitations past their TTL for an organization. Used
   * by the profile domain's workspace detail read, so a stale invitation list
   * never gets served back to a member.
   */
  async expirePendingInvitations(
    organizationId: Uuid,
    invitations: Array<{
      id: string;
      status: string;
      expiresAt: string;
      emailHint: string;
    }>,
  ): Promise<boolean> {
    const expiredInvitations = invitations.filter(
      (invitation) =>
        invitation.status === "pending" &&
        new Date(invitation.expiresAt).getTime() <= Date.now(),
    );

    if (expiredInvitations.length === 0) {
      return false;
    }

    await Promise.all(
      expiredInvitations.map(async (invitation) => {
        const expired =
          await this.organizationsInvitationsRepository.expireInvitation(
            asUuid(invitation.id),
            new Date(),
          );
        const expiredInvitation = expired ?? {
          ...invitation,
          status: "expired" as const,
        };

        await this.organizationAuditService.recordSafely({
          organizationId,
          actorUserId: null,
          action: "invitation.expired",
          resourceType: "invitation",
          resourceId: invitation.id,
          summary: `${invitation.emailHint} invitation expired.`,
          changes: createChanges(invitation, expiredInvitation),
          beforeSnapshot: invitation,
          afterSnapshot: expiredInvitation,
          restorable: true,
        });
      }),
    );

    return true;
  }

  private assertCanRevokeInvitation(
    actorRole: OrganizationRole,
    invitation: OrganizationInviteAccessRecord,
  ): void {
    if (invitation.status !== "pending") {
      throw new BadRequestError("Only pending invitations can be revoked.");
    }

    if (actorRole === "primary_manager") {
      return;
    }

    if (actorRole === "manager" && invitation.role === "operator") {
      return;
    }

    throw new ForbiddenError(
      "You do not have permission to revoke this invitation.",
    );
  }

  private async requireInvitation(
    organizationId: Uuid,
    invitationId: Uuid,
  ) {
    const invitation =
      await this.organizationsInvitationsRepository.findInvitationById(
        organizationId,
        invitationId,
      );

    if (!invitation) {
      throw new ResourceNotFoundError(
        "Organization invitation could not be found.",
      );
    }

    return invitation;
  }

  private async requireInvitationByToken(token: string) {
    const invitation =
      await this.organizationsInvitationsRepository.findInvitationByTokenHash(
        hashInviteToken(token),
      );

    if (!invitation) {
      throw new ResourceNotFoundError(
        "Organization invitation could not be found.",
      );
    }

    return invitation;
  }

  private async ensureInvitationExpiry(
    invitation: OrganizationInviteAccessRecord,
  ): Promise<OrganizationInviteAccessRecord> {
    if (
      invitation.status === "pending" &&
      new Date(invitation.expiresAt).getTime() <= Date.now()
    ) {
      const expired =
        await this.organizationsInvitationsRepository.expireInvitation(
          asUuid(invitation.id),
          new Date(),
        );

      const expiredInvitation = expired
        ? {
            ...expired,
            organization: invitation.organization,
          }
        : {
            ...invitation,
            status: "expired" as const,
          };

      await this.organizationAuditService.recordSafely({
        organizationId: asUuid(invitation.organization.id),
        actorUserId: null,
        action: "invitation.expired",
        resourceType: "invitation",
        resourceId: invitation.id,
        summary: `${invitation.emailHint} invitation expired.`,
        changes: createChanges(invitation, expiredInvitation),
        beforeSnapshot: invitation,
        afterSnapshot: expiredInvitation,
        restorable: true,
      });

      return expiredInvitation;
    }

    return invitation;
  }
}
