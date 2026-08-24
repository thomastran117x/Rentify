import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import type { EmailService } from "@/features/email/email.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import {
  requireOrganizationMembershipAccess,
  requirePrimaryManager,
} from "@/features/organizations/organization-membership-access";
import { createChanges } from "@/features/organizations/organization-audit-changes";
import {
  createInviteToken,
  hashInviteToken,
} from "@/features/organizations/organization-invite-token";
import { assertCanInvite } from "@/features/organizations/organization-invite-authorization";
import type { OrganizationLogoService } from "@/features/organizations/organization-logo.service";
import type { OrganizationPostingProjectionService } from "@/features/organizations/organization-posting-projection.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import type { OrganizationsProfileRepository } from "@/features/organizations/profile/profile.repository";
import type {
  OrganizationsMembersRepository,
  OrganizationMembershipAccessRecord,
} from "@/features/organizations/members/members.repository";
import type { OrganizationsInvitationsRepository } from "@/features/organizations/invitations/invitations.repository";
import type {
  OrganizationProfileInput,
  OrganizationRole,
} from "@/features/organizations/organizations.model";
import type { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import {
  toAuditSnapshotRecord,
  type CreateOrganizationAuditLogInput,
  type ListOrganizationAuditInput,
  type ListOrganizationAuditResult,
  type OrganizationAuditRecord,
  type RestoreOrganizationVersionInput,
  type RestoreOrganizationVersionResult,
} from "@/features/organizations/audit/audit.model";

export class OrganizationAuditService {
  private readonly logger = loggerFactory.forClass(
    OrganizationAuditService,
    "service",
  );

  constructor(
    private readonly repository: OrganizationAuditRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationsProfileRepository: OrganizationsProfileRepository,
    private readonly organizationsMembersRepository: OrganizationsMembersRepository,
    private readonly organizationsInvitationsRepository: OrganizationsInvitationsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly seasonalPricingRepository: SeasonalPricingRepository,
    private readonly emailService: EmailService,
    private readonly organizationLogoService: OrganizationLogoService,
    private readonly organizationPostingProjectionService: OrganizationPostingProjectionService,
  ) {}

  async record(
    input: CreateOrganizationAuditLogInput,
  ): Promise<OrganizationAuditRecord> {
    return this.repository.create(input);
  }

  /**
   * Same as `record`, but swallows failures: used from flows (profile writes,
   * membership/invitation changes) where a missing audit entry is recoverable
   * and must never fail the action that triggered it.
   */
  async recordSafely(input: CreateOrganizationAuditLogInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error("Failed to record organization audit entry.", {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? undefined,
        error,
      });
    }
  }

  async list(
    input: ListOrganizationAuditInput,
  ): Promise<ListOrganizationAuditResult> {
    await this.requireManager(input.actorUserId, input.organizationId);
    return this.repository.list(input);
  }

  async requireRestorableAudit(
    input: RestoreOrganizationVersionInput,
  ): Promise<OrganizationAuditRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const auditLog = await this.repository.findById(
      input.organizationId,
      input.auditId,
    );

    if (!auditLog) {
      throw new ResourceNotFoundError(
        "Organization audit entry could not be found.",
      );
    }

    if (!auditLog.restorable) {
      throw new ConflictError("This audit entry cannot be restored.");
    }

    return auditLog;
  }

  async hasRestorableOrganizationLogoReference(input: {
    organizationId: string;
    blobName: string;
  }): Promise<boolean> {
    return this.repository.hasRestorableOrganizationLogoReference(input);
  }

  async restoreVersion(
    input: RestoreOrganizationVersionInput,
  ): Promise<RestoreOrganizationVersionResult> {
    const auditLog = await this.requireRestorableAudit(input);
    const actorMembership = await requireOrganizationMembershipAccess(
      this.organizationsMembersRepository,
      input.actorUserId,
      input.organizationId,
    );
    this.assertCanRestoreVersion(actorMembership, auditLog);
    let beforeCleanupSnapshot: unknown;
    let afterSnapshot: unknown;
    let action: RestoreOrganizationVersionResult["auditLog"]["action"];
    let summary: string;

    switch (auditLog.resourceType) {
      case "organization": {
        const snapshot = toAuditSnapshotRecord(auditLog.beforeSnapshot);
        const name = typeof snapshot.name === "string" ? snapshot.name : null;
        if (!name) {
          throw new ConflictError(
            "This organization version cannot be restored.",
          );
        }
        beforeCleanupSnapshot = auditLog.afterSnapshot;
        afterSnapshot = await this.organizationsProfileRepository.updateOrganization(
          input.organizationId,
          {
            name,
            ...this.readProfileFromSnapshot(snapshot),
          },
        );
        action = "organization.restored";
        summary = `Organization restored to ${name}.`;
        await this.organizationPostingProjectionService.cascade(
          input.organizationId,
          { reindex: true },
        );
        break;
      }
      case "member": {
        const snapshot = toAuditSnapshotRecord(auditLog.beforeSnapshot);
        const restored = await this.organizationsMembersRepository.restoreMembership({
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
        const restored =
          await this.postingsRepository.restoreOwnerAvailabilityBlock(
            auditLog.beforeSnapshot,
          );
        if (!restored) {
          throw new ConflictError(
            "This availability version cannot be restored.",
          );
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
          throw new ConflictError(
            "This seasonal pricing version cannot be restored.",
          );
        }
        afterSnapshot = restored;
        action = "seasonal_pricing.restored";
        summary = `${restored.name} seasonal pricing was restored.`;
        break;
      }
      case "invitation": {
        const snapshot = toAuditSnapshotRecord(auditLog.beforeSnapshot);
        const email =
          typeof snapshot.email === "string" ? snapshot.email : null;
        const role = snapshot.role as OrganizationRole | undefined;
        if (!email || !role || role === "primary_manager") {
          throw new ConflictError(
            "This invitation version cannot be restored.",
          );
        }
        const token = createInviteToken();
        const invitation = await this.organizationsInvitationsRepository.reissueInvitation(
          {
            organizationId: input.organizationId,
            invitedByUserId: input.actorUserId,
            email,
            role,
            tokenHash: hashInviteToken(token),
            expiresAt: new Date(Date.now() + ORGANIZATION_INVITE_TTL_MS),
            now: new Date(),
          },
        );
        await this.emailService.sendOrganizationInviteEmail({
          to: email,
          organizationName: actorMembership.organization.name,
          inviterName: invitation.invitedBy.username,
          role,
          token,
        });
        afterSnapshot = invitation;
        action = "invitation.restored";
        summary = `${invitation.emailHint} invitation was restored.`;
        break;
      }
      default: {
        throw new ConflictError("This version cannot be restored.");
      }
    }

    const restoredAuditLog = await this.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      summary,
      changes: createChanges(auditLog.afterSnapshot, afterSnapshot),
      beforeSnapshot: auditLog.afterSnapshot,
      afterSnapshot,
      restorable: false,
      restoredFromAuditId: auditLog.id,
    });

    if (
      auditLog.resourceType === "organization" &&
      beforeCleanupSnapshot !== undefined
    ) {
      await this.organizationLogoService.cleanupReplacedLogo({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        beforeSnapshot: beforeCleanupSnapshot,
        afterSnapshot,
      });
    }

    return {
      restored: true,
      auditLog: restoredAuditLog,
    };
  }

  private assertCanRestoreVersion(
    actorMembership: OrganizationMembershipAccessRecord,
    auditLog: OrganizationAuditRecord,
  ): void {
    switch (auditLog.resourceType) {
      case "organization":
        requirePrimaryManager(actorMembership.role);
        return;
      case "member":
        this.assertCanRestoreMember(actorMembership, auditLog);
        return;
      case "invitation":
        this.assertCanRestoreInvitation(actorMembership, auditLog);
        return;
      case "posting":
      case "posting_availability":
      case "seasonal_pricing":
        return;
      default:
        throw new ConflictError("This version cannot be restored.");
    }
  }

  private assertCanRestoreMember(
    actorMembership: OrganizationMembershipAccessRecord,
    auditLog: OrganizationAuditRecord,
  ): void {
    const snapshot = toAuditSnapshotRecord(auditLog.beforeSnapshot);
    const restoredRole = snapshot.role as OrganizationRole | undefined;

    if (!restoredRole || restoredRole === "primary_manager") {
      throw new ConflictError("This member version cannot be restored.");
    }

    if (auditLog.action === "member.role_updated") {
      requirePrimaryManager(actorMembership.role);
      return;
    }

    if (actorMembership.role === "primary_manager") {
      return;
    }

    if (actorMembership.role === "manager" && restoredRole === "operator") {
      return;
    }

    throw new ForbiddenError(
      "You do not have permission to restore this member version.",
    );
  }

  private assertCanRestoreInvitation(
    actorMembership: OrganizationMembershipAccessRecord,
    auditLog: OrganizationAuditRecord,
  ): void {
    const snapshot = toAuditSnapshotRecord(auditLog.beforeSnapshot);
    const restoredRole = snapshot.role as OrganizationRole | undefined;

    if (!restoredRole) {
      throw new ConflictError("This invitation version cannot be restored.");
    }

    assertCanInvite(actorMembership.role, restoredRole);
  }

  // Coerce a stored audit snapshot back into an organization profile input so
  // a restore reverts every editable field, not just the name.
  private readProfileFromSnapshot(
    snapshot: Record<string, unknown>,
  ): OrganizationProfileInput {
    const textFields = [
      "description",
      "websiteUrl",
      "contactEmail",
      "contactPhone",
      "addressLine1",
      "addressLine2",
      "city",
      "region",
      "country",
      "postalCode",
      "logoUrl",
      "logoBlobName",
    ] as const;
    const result: OrganizationProfileInput = {};
    for (const field of textFields) {
      const value = snapshot[field];
      if (typeof value === "string") {
        result[field] = value;
      } else if (value === null) {
        result[field] = null;
      }
    }

    const customFields = snapshot.customFields;
    if (customFields === null) {
      result.customFields = null;
    } else if (
      customFields &&
      typeof customFields === "object" &&
      !Array.isArray(customFields)
    ) {
      const parsed: Record<string, string> = {};
      for (const [key, entry] of Object.entries(customFields)) {
        if (typeof entry === "string") {
          parsed[key] = entry;
        }
      }
      result.customFields = parsed;
    }

    return result;
  }

  private async requireManager(
    actorUserId: string,
    organizationId: string,
  ): Promise<void> {
    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (
      membership.role !== "primary_manager" &&
      membership.role !== "manager"
    ) {
      throw new ForbiddenError(
        "Only organization managers can view audit history.",
      );
    }
  }
}

const ORGANIZATION_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
