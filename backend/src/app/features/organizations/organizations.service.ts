import { createHash, randomBytes } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { AuthRepository } from "@/features/auth/auth.repository";
import { EmailService } from "@/features/email/email.service";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import type {
  ListOrganizationAuditInput,
  ListOrganizationAuditResult,
  OrganizationAuditChange,
  RestoreOrganizationVersionInput,
  RestoreOrganizationVersionResult,
} from "@/features/organizations/organization-audit.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import {
  normalizeOrganizationInvitationEmail,
  type AcceptOrganizationInviteInput,
  type AcceptOrganizationInviteResult,
  type CreateOrganizationInput,
  type CreateOrganizationInviteInput,
  type CreateOrganizationInviteResult,
  type CreateOrganizationResult,
  type OrganizationDetailResult,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationMembershipSummary,
  type OrganizationRole,
  type OrganizationSummary,
  type OrganizationWorkspaceResult,
  type PreviewOrganizationInviteInput,
  type OrganizationInvitePreviewResult,
  type RemoveOrganizationMemberInput,
  type RevokeOrganizationInviteInput,
  type SetActiveOrganizationInput,
  type SetActiveOrganizationResult,
  type UpdateOrganizationInput,
  type UpdateOrganizationMemberInput,
} from "@/features/organizations/organizations.model";
import {
  OrganizationInviteAccessRecord,
  OrganizationsRepository,
} from "@/features/organizations/organizations.repository";

const ORGANIZATION_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly authRepository: AuthRepository,
    private readonly emailService: EmailService,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly postingsRepository: PostingsRepository,
    private readonly seasonalPricingRepository: SeasonalPricingRepository,
  ) {}

  async listMine(userId: string): Promise<OrganizationWorkspaceResult> {
    const user = await this.requireExistingUser(userId);
    const memberships =
      await this.organizationsRepository.listMembershipsByUserId(
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
    const membership = await this.requireMembership(
      input.userId,
      input.organizationId,
    );
    await this.organizationsRepository.setPreferredOrganization(
      input.userId,
      input.organizationId,
    );

    return {
      activeOrganization: {
        id: membership.organization.id,
        name: membership.organization.name,
        role: membership.role,
      },
    };
  }

  async getById(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationDetailResult> {
    const membership = await this.requireMembership(userId, organizationId);
    let detail =
      await this.organizationsRepository.findOrganizationDetail(organizationId);

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (await this.expirePendingInvitations(organizationId, detail.invitations)) {
      detail =
        await this.organizationsRepository.findOrganizationDetail(
          organizationId,
        );
    }

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return {
      ...detail,
      viewerRole: membership.role,
    };
  }

  async listAudit(
    input: ListOrganizationAuditInput,
  ): Promise<ListOrganizationAuditResult> {
    return this.organizationAuditService.list(input);
  }

  async restoreVersion(
    input: RestoreOrganizationVersionInput,
  ): Promise<RestoreOrganizationVersionResult> {
    const auditLog = await this.organizationAuditService.requireRestorableAudit(input);
    let afterSnapshot: unknown;
    let action: RestoreOrganizationVersionResult["auditLog"]["action"];
    let summary: string;

    switch (auditLog.resourceType) {
      case "organization": {
        const snapshot = this.toPlainRecord(auditLog.beforeSnapshot);
        const name = typeof snapshot.name === "string" ? snapshot.name : null;
        if (!name) {
          throw new ConflictError("This organization version cannot be restored.");
        }
        afterSnapshot = await this.organizationsRepository.updateOrganizationName(
          input.organizationId,
          name,
        );
        action = "organization.restored";
        summary = `Organization restored to ${name}.`;
        break;
      }
      case "member": {
        const snapshot = this.toPlainRecord(auditLog.beforeSnapshot);
        const restored = await this.organizationsRepository.restoreMembership({
          membershipId: String(snapshot.membershipId ?? auditLog.resourceId),
          organizationId: input.organizationId,
          userId: String(snapshot.userId ?? ""),
          role: String(snapshot.role ?? "operator") as OrganizationRole,
        });
        afterSnapshot = restored;
        action = "member.restored";
        summary = `${restored.username} was restored as ${restored.role}.`;
        break;
      }
      case "posting": {
        const restored = await this.postingsRepository.restoreFromSnapshot(
          auditLog.beforeSnapshot,
        );
        if (!restored) {
          throw new ConflictError("This posting version cannot be restored.");
        }
        afterSnapshot = restored;
        action = "posting.restored";
        summary = `${restored.name} was restored.`;
        break;
      }
      case "posting_availability": {
        const restored = await this.postingsRepository.restoreOwnerAvailabilityBlock(
          auditLog.beforeSnapshot,
        );
        if (!restored) {
          throw new ConflictError("This availability version cannot be restored.");
        }
        afterSnapshot = restored;
        action = "posting_availability.restored";
        summary = "Posting availability was restored.";
        break;
      }
      case "seasonal_pricing": {
        const restored = await this.seasonalPricingRepository.restore(
          auditLog.beforeSnapshot,
        );
        if (!restored) {
          throw new ConflictError("This seasonal pricing version cannot be restored.");
        }
        afterSnapshot = restored;
        action = "seasonal_pricing.restored";
        summary = `${restored.name} seasonal pricing was restored.`;
        break;
      }
      case "invitation": {
        const snapshot = this.toPlainRecord(auditLog.beforeSnapshot);
        const email = typeof snapshot.email === "string" ? snapshot.email : null;
        const role = snapshot.role as OrganizationRole | undefined;
        if (!email || !role || role === "primary_manager") {
          throw new ConflictError("This invitation version cannot be restored.");
        }
        const membership = await this.requireMembership(
          input.actorUserId,
          input.organizationId,
        );
        const token = this.createInviteToken();
        const invitation = await this.organizationsRepository.reissueInvitation({
          organizationId: input.organizationId,
          invitedByUserId: input.actorUserId,
          email,
          role,
          tokenHash: this.hashInviteToken(token),
          expiresAt: new Date(Date.now() + ORGANIZATION_INVITE_TTL_MS),
          now: new Date(),
        });
        await this.emailService.sendOrganizationInviteEmail({
          to: email,
          organizationName: membership.organization.name,
          inviterName: invitation.invitedBy.username,
          role,
          token,
        });
        afterSnapshot = invitation;
        action = "invitation.restored";
        summary = `${invitation.emailHint} invitation was restored.`;
        break;
      }
    }

    const restoredAuditLog = await this.organizationAuditService.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      summary,
      changes: this.createChanges(auditLog.afterSnapshot, afterSnapshot),
      beforeSnapshot: auditLog.afterSnapshot,
      afterSnapshot,
      restorable: false,
      restoredFromAuditId: auditLog.id,
    });

    return {
      restored: true,
      auditLog: restoredAuditLog,
    };
  }
  async createOrganization(
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationResult> {
    await this.requireExistingUser(input.actorUserId);

    const membership =
      await this.organizationsRepository.createOrganizationWithOwner({
        name: input.name.trim(),
        ownerUserId: input.actorUserId,
      });

    await this.organizationsRepository.setPreferredOrganization(
      input.actorUserId,
      membership.id,
    );

    await this.organizationAuditService.record({
      organizationId: membership.id,
      actorUserId: input.actorUserId,
      action: "organization.created",
      resourceType: "organization",
      resourceId: membership.id,
      summary: `${membership.name} was created.`,
      changes: this.createChanges(null, {
        id: membership.id,
        name: membership.name,
      }),
      afterSnapshot: {
        id: membership.id,
        name: membership.name,
      },
      restorable: false,
    });

    return {
      organization: {
        id: membership.id,
        name: membership.name,
        role: membership.role,
      },
      membership: {
        ...membership,
        isActive: true,
      },
    };
  }

  async update(input: UpdateOrganizationInput): Promise<OrganizationSummary> {
    const membership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    this.requirePrimaryManager(membership.role);

    const beforeSnapshot = membership.organization;
    const updated = await this.organizationsRepository.updateOrganizationName(
      input.organizationId,
      input.name.trim(),
    );
    const afterSnapshot = {
      ...beforeSnapshot,
      name: updated.name,
    };

    await this.organizationAuditService.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.renamed",
      resourceType: "organization",
      resourceId: input.organizationId,
      summary: `Organization renamed from ${beforeSnapshot.name} to ${updated.name}.`,
      changes: this.createChanges(beforeSnapshot, afterSnapshot, ["name"]),
      beforeSnapshot,
      afterSnapshot,
      restorable: true,
    });

    return {
      ...updated,
      role: membership.role,
    };
  }

  async createInvitation(
    input: CreateOrganizationInviteInput,
  ): Promise<CreateOrganizationInviteResult> {
    const membership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    const email = normalizeOrganizationInvitationEmail(input.email);
    this.assertCanInvite(membership.role, input.role);

    const existingMember = await this.organizationsRepository.findMemberByEmail(
      input.organizationId,
      email,
    );

    if (existingMember) {
      throw new ConflictError(
        "That user is already a member of this organization.",
      );
    }

    const token = this.createInviteToken();
    const invitation = await this.organizationsRepository.reissueInvitation({
      organizationId: input.organizationId,
      invitedByUserId: input.actorUserId,
      email,
      role: input.role,
      tokenHash: this.hashInviteToken(token),
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

    await this.organizationAuditService.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "invitation.created",
      resourceType: "invitation",
      resourceId: invitation.id,
      summary: `${invitation.emailHint} was invited as ${input.role}.`,
      changes: this.createChanges(null, invitation),
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
    const membership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    let invitation = await this.requireInvitation(
      input.organizationId,
      input.invitationId,
    );

    invitation = await this.ensureInvitationExpiry(invitation);
    this.assertCanRevokeInvitation(membership.role, invitation);

    const revoked = await this.organizationsRepository.revokeInvitation(
      invitation.id,
      new Date(),
    );

    if (!revoked) {
      throw new ConflictError("This invitation can no longer be revoked.");
    }

    await this.organizationAuditService.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "invitation.revoked",
      resourceType: "invitation",
      resourceId: revoked.id,
      summary: `${revoked.emailHint} invitation was revoked.`,
      changes: this.createChanges(invitation, revoked, ["status", "revokedAt"]),
      beforeSnapshot: invitation,
      afterSnapshot: revoked,
      restorable: true,
    });

    return {
      invitation: revoked,
    };
  }

  async updateMemberRole(
    input: UpdateOrganizationMemberInput,
  ): Promise<{ member: OrganizationMemberRecord }> {
    const actorMembership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    const targetMember = await this.requireMember(
      input.organizationId,
      input.membershipId,
    );

    this.assertCanUpdateMemberRole(actorMembership, targetMember, input.role);

    const updated = await this.organizationsRepository.updateMembershipRole(
      targetMember.membershipId,
      input.role,
    );

    await this.organizationAuditService.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "member.role_updated",
      resourceType: "member",
      resourceId: targetMember.membershipId,
      summary: `${targetMember.username} changed from ${targetMember.role} to ${updated.role}.`,
      changes: this.createChanges(targetMember, updated, ["role"]),
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
    const actorMembership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    const targetMember = await this.requireMember(
      input.organizationId,
      input.membershipId,
    );

    this.assertCanRemoveMember(actorMembership, targetMember);

    const removed = await this.organizationsRepository.removeMembership(
      targetMember.membershipId,
    );

    if (!removed) {
      throw new ConflictError("This member could not be removed.");
    }

    const targetUser = await this.requireExistingUser(targetMember.userId);

    if (targetUser.preferredOrganizationId === input.organizationId) {
      await this.organizationsRepository.setPreferredOrganization(
        targetMember.userId,
        null,
      );
    }

    await this.organizationAuditService.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "member.removed",
      resourceType: "member",
      resourceId: targetMember.membershipId,
      summary: `${targetMember.username} was removed from the organization.`,
      changes: this.createChanges(targetMember, null),
      beforeSnapshot: targetMember,
      afterSnapshot: null,
      restorable: true,
    });

    return {
      removed: true,
      membershipId: targetMember.membershipId,
    };
  }

  async previewInvitation(
    input: PreviewOrganizationInviteInput,
  ): Promise<OrganizationInvitePreviewResult> {
    let invitation = await this.requireInvitationByToken(input.token);
    invitation = await this.ensureInvitationExpiry(invitation);

    const user = input.userId
      ? await this.authRepository.findUserById(input.userId)
      : null;
    const normalizedViewerEmail = user?.email?.trim().toLowerCase();
    const matchesEmail =
      typeof normalizedViewerEmail === "string" &&
      normalizedViewerEmail === invitation.email;

    return {
      invitation: {
        organizationId: invitation.organization.id,
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
    const user = await this.requireExistingUser(input.userId);

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
        await this.organizationsRepository.findMemberByUserId(
          invitation.organization.id,
          user.id,
        );

      if (!existingMember) {
        throw new ConflictError(
          "This invitation was already accepted, but the membership record is missing.",
        );
      }

      const memberships =
        await this.organizationsRepository.listMembershipsByUserId(
          user.id,
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
          name: invitation.organization.name,
          role: membership.role,
        },
        membership,
      };
    }

    if (invitation.status !== "pending") {
      throw new BadRequestError("This invitation can no longer be accepted.");
    }

    const { invitation: acceptedInvitation, membership } = await this.organizationsRepository.acceptInvitation({
      invitationId: invitation.id,
      organizationId: invitation.organization.id,
      userId: user.id,
      role: invitation.role,
      now: new Date(),
    });

    if (!user.preferredOrganizationId) {
      await this.organizationsRepository.setPreferredOrganization(
        user.id,
        invitation.organization.id,
      );
    }

    const memberships =
      await this.organizationsRepository.listMembershipsByUserId(
        user.id,
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

    await this.organizationAuditService.record({
      organizationId: invitation.organization.id,
      actorUserId: user.id,
      action: "invitation.accepted",
      resourceType: "invitation",
      resourceId: acceptedInvitation.id,
      summary: `${acceptedInvitation.emailHint} invitation was accepted.`,
      changes: this.createChanges(invitation, acceptedInvitation),
      beforeSnapshot: invitation,
      afterSnapshot: acceptedInvitation,
      restorable: false,
    });

    return {
      accepted: true,
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
        role: membership.role,
      },
      membership: membershipSummary,
    };
  }

  private async requireExistingUser(userId: string) {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new ResourceNotFoundError("User account could not be found.");
    }

    return user;
  }

  private async requireMembership(userId: string, organizationId: string) {
    const membership = await this.organizationsRepository.findMembershipAccess(
      userId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return membership;
  }

  private async requireInvitation(
    organizationId: string,
    invitationId: string,
  ) {
    const invitation = await this.organizationsRepository.findInvitationById(
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
      await this.organizationsRepository.findInvitationByTokenHash(
        this.hashInviteToken(token),
      );

    if (!invitation) {
      throw new ResourceNotFoundError(
        "Organization invitation could not be found.",
      );
    }

    return invitation;
  }

  private async requireMember(
    organizationId: string,
    membershipId: string,
  ): Promise<OrganizationMemberRecord> {
    const member = await this.organizationsRepository.findMemberById(
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

  private requirePrimaryManager(role: OrganizationRole): void {
    if (role !== "primary_manager") {
      throw new ForbiddenError(
        "Only the primary manager can perform this action.",
      );
    }
  }

  private assertCanInvite(
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

  private assertCanUpdateMemberRole(
    actorMembership: { membershipId: string; role: OrganizationRole },
    targetMember: OrganizationMemberRecord,
    nextRole: OrganizationRole,
  ): void {
    this.requirePrimaryManager(actorMembership.role);

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

  private createChanges(
    beforeSnapshot: unknown,
    afterSnapshot: unknown,
    fields?: string[],
  ): OrganizationAuditChange[] {
    const beforeRecord = this.toPlainRecord(beforeSnapshot);
    const afterRecord = this.toPlainRecord(afterSnapshot);
    const keys = fields ??
      Array.from(
        new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]),
      );

    return keys
      .filter(
        (key) =>
          JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]),
      )
      .map((key) => ({
        field: key,
        before: beforeRecord[key] ?? null,
        after: afterRecord[key] ?? null,
      }));
  }

  private toPlainRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
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
      name: activeMembership.name,
      role: activeMembership.role,
    };
  }

  private createInviteToken(): string {
    return randomBytes(32).toString("base64url");
  }

  private hashInviteToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private async ensureInvitationExpiry(
    invitation: OrganizationInviteAccessRecord,
  ): Promise<OrganizationInviteAccessRecord> {
    if (
      invitation.status === "pending" &&
      new Date(invitation.expiresAt).getTime() <= Date.now()
    ) {
      const expired = await this.organizationsRepository.expireInvitation(
        invitation.id,
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

      await this.organizationAuditService.record({
        organizationId: invitation.organization.id,
        actorUserId: null,
        action: "invitation.expired",
        resourceType: "invitation",
        resourceId: invitation.id,
        summary: `${invitation.emailHint} invitation expired.`,
        changes: this.createChanges(invitation, expiredInvitation),
        beforeSnapshot: invitation,
        afterSnapshot: expiredInvitation,
        restorable: true,
      });

      return expiredInvitation;
    }

    return invitation;
  }

  private async expirePendingInvitations(
    organizationId: string,
    invitations: OrganizationInvitationRecord[],
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
        const expired = await this.organizationsRepository.expireInvitation(
          invitation.id,
          new Date(),
        );
        const expiredInvitation = expired ?? {
          ...invitation,
          status: "expired" as const,
        };

        await this.organizationAuditService.record({
          organizationId,
          actorUserId: null,
          action: "invitation.expired",
          resourceType: "invitation",
          resourceId: invitation.id,
          summary: `${invitation.emailHint} invitation expired.`,
          changes: this.createChanges(invitation, expiredInvitation),
          beforeSnapshot: invitation,
          afterSnapshot: expiredInvitation,
          restorable: true,
        });
      }),
    );

    return true;
  }
}










