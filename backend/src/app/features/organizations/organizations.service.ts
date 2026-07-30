import { createHash, randomBytes } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import { AuthRepository } from "@/features/auth/auth.repository";
import { BlobService } from "@/features/blob/blob.service";
import { EmailService } from "@/features/email/email.service";
import type { OrganizationAnnouncementService } from "@/features/organizations/organization-announcement.service";
import type {
  CreateOrganizationAnnouncementInput,
  DeleteOrganizationAnnouncementInput,
  DeleteOrganizationAnnouncementResult,
  ListOrganizationAnnouncementsInput,
  ListOrganizationAnnouncementsResult,
  OrganizationAnnouncementRecord,
  UpdateOrganizationAnnouncementInput,
} from "@/features/organizations/organization-announcement.model";
import type { OrganizationBlogService } from "@/features/organizations/organization-blog.service";
import type {
  CreateOrganizationBlogPostInput,
  DeleteOrganizationBlogPostInput,
  DeleteOrganizationBlogPostResult,
  GetPublicOrganizationBlogPostInput,
  ListOrganizationBlogPostsInput,
  ListOrganizationBlogPostsResult,
  ListPublicBlogFeedInput,
  ListPublicOrganizationBlogPostsInput,
  OrganizationBlogPostRecord,
  UpdateOrganizationBlogPostInput,
} from "@/features/organizations/organization-blog.model";
import type { OrganizationReviewService } from "@/features/organizations/organization-review.service";
import type {
  DeleteOrganizationReviewInput,
  DeleteOrganizationReviewResult,
  DeleteOwnOrganizationReviewInput,
  ListOrganizationReviewsInput,
  ListOrganizationReviewsResult,
  OrganizationReviewRecord,
  RemoveOrganizationReviewReplyInput,
  ReplyOrganizationReviewInput,
  UpsertOrganizationReviewInput,
} from "@/features/organizations/organization-review.model";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import {
  createAuditChanges as buildAuditChanges,
  toAuditSnapshotRecord,
  type CreateOrganizationAuditLogInput,
  type OrganizationAuditRecord,
  type ListOrganizationAuditInput,
  type ListOrganizationAuditResult,
  type RestoreOrganizationVersionInput,
  type RestoreOrganizationVersionResult,
} from "@/features/organizations/organization-audit.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import {
  normalizeOrganizationInvitationEmail,
  pickOrganizationProfileInput,
  ORGANIZATION_EDITABLE_FIELDS,
  type AcceptOrganizationInviteInput,
  type AcceptOrganizationInviteResult,
  type CreateOrganizationInput,
  type CreateOrganizationInviteInput,
  type CreateOrganizationInviteResult,
  type CreateOrganizationResult,
  type ListPublicOrganizationsInput,
  type OrganizationInvitationRecord,
  type OrganizationInvitePreviewResult,
  type OrganizationMemberRecord,
  type OrganizationMembershipSummary,
  type OrganizationProfileInput,
  type OrganizationRole,
  type OrganizationSummary,
  type OrganizationWorkspaceDetailResult,
  type OrganizationWorkspaceResult,
  type PreviewOrganizationInviteInput,
  type PublicOrganizationDetailResult,
  type PublicOrganizationListResult,
  type RemoveOrganizationMemberInput,
  type ResolvedOrganizationReference,
  type ChangeOrganizationSlugInput,
  type RevokeOrganizationInviteInput,
  type SetActiveOrganizationInput,
  type SetActiveOrganizationResult,
  type UpdateOrganizationInput,
  type UpdateOrganizationMemberInput,
} from "@/features/organizations/organizations.model";
import {
  OrganizationInviteAccessRecord,
  type OrganizationMembershipAccessRecord,
  OrganizationsRepository,
} from "@/features/organizations/organizations.repository";
import type { OrganizationsPublicSearchService } from "@/features/organizations/search/public-search.service";
import {
  ORGANIZATION_SLUG_MAX_LENGTH,
  generateShortSlugSuffix,
  isReservedOrganizationSlug,
  nextSlugCandidate,
  slugify,
  withSuffix,
} from "@/features/organizations/organization-slug";

const ORGANIZATION_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CREATE_SLUG_ATTEMPTS = 10;

/**
 * True when the error is the organizations.slug unique-index violation.
 *
 * Deliberately narrow: a P2002 on some other unique constraint means something
 * genuinely unexpected happened and must not be retried away.
 */
function isOrganizationSlugConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    (error as { code?: unknown }).code !== "P2002"
  ) {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  if (typeof target === "string") {
    return target.includes("slug");
  }

  return (
    Array.isArray(target) &&
    target.some((entry) => typeof entry === "string" && entry.includes("slug"))
  );
}

export class OrganizationsService {
  private readonly logger = loggerFactory.forClass(
    OrganizationsService,
    "service",
  );

  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly authRepository: AuthRepository,
    private readonly emailService: EmailService,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly postingsRepository: PostingsRepository,
    private readonly seasonalPricingRepository: SeasonalPricingRepository,
    private readonly blobService: BlobService,
    private readonly organizationsPublicSearchService: OrganizationsPublicSearchService,
    private readonly organizationAnnouncementService: OrganizationAnnouncementService,
    private readonly organizationBlogService: OrganizationBlogService,
    private readonly organizationReviewService: OrganizationReviewService,
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
        slug: membership.organization.slug,
        name: membership.organization.name,
        role: membership.role,
      },
    };
  }

  async listPublic(
    input: ListPublicOrganizationsInput,
  ): Promise<PublicOrganizationListResult> {
    return this.organizationsPublicSearchService.searchPublic({
      page: input.page,
      pageSize: input.pageSize,
      query: input.query?.trim() || undefined,
      sort: input.sort,
    });
  }

  async getById(
    organizationId: string,
  ): Promise<PublicOrganizationDetailResult> {
    const detail =
      await this.organizationsRepository.findPublicOrganizationDetail(
        organizationId,
      );

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return detail;
  }

  async getWorkspaceById(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationWorkspaceDetailResult> {
    const membership = await this.requireMembership(userId, organizationId);
    let detail =
      await this.organizationsRepository.findOrganizationDetail(organizationId);

    if (!detail) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (
      await this.expirePendingInvitations(organizationId, detail.invitations)
    ) {
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

  async listAnnouncements(
    input: ListOrganizationAnnouncementsInput,
  ): Promise<ListOrganizationAnnouncementsResult> {
    return this.organizationAnnouncementService.list(input);
  }

  async createAnnouncement(
    input: CreateOrganizationAnnouncementInput,
  ): Promise<OrganizationAnnouncementRecord> {
    return this.organizationAnnouncementService.create(input);
  }

  async updateAnnouncement(
    input: UpdateOrganizationAnnouncementInput,
  ): Promise<OrganizationAnnouncementRecord> {
    return this.organizationAnnouncementService.update(input);
  }

  async deleteAnnouncement(
    input: DeleteOrganizationAnnouncementInput,
  ): Promise<DeleteOrganizationAnnouncementResult> {
    return this.organizationAnnouncementService.delete(input);
  }

  async listBlogPosts(
    input: ListOrganizationBlogPostsInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    return this.organizationBlogService.list(input);
  }

  async listPublicBlogPosts(
    input: ListPublicOrganizationBlogPostsInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    return this.organizationBlogService.listPublished(input);
  }

  async searchPublicBlogFeed(
    input: ListPublicBlogFeedInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    return this.organizationBlogService.searchGlobal(input);
  }

  async getPublicBlogPostBySlug(
    input: GetPublicOrganizationBlogPostInput,
  ): Promise<OrganizationBlogPostRecord> {
    return this.organizationBlogService.getPublishedBySlug(input);
  }

  async createBlogPost(
    input: CreateOrganizationBlogPostInput,
  ): Promise<OrganizationBlogPostRecord> {
    return this.organizationBlogService.create(input);
  }

  async updateBlogPost(
    input: UpdateOrganizationBlogPostInput,
  ): Promise<OrganizationBlogPostRecord> {
    return this.organizationBlogService.update(input);
  }

  async deleteBlogPost(
    input: DeleteOrganizationBlogPostInput,
  ): Promise<DeleteOrganizationBlogPostResult> {
    return this.organizationBlogService.delete(input);
  }

  async listReviews(
    input: ListOrganizationReviewsInput,
  ): Promise<ListOrganizationReviewsResult> {
    return this.organizationReviewService.list(input);
  }

  async getOwnReview(
    input: DeleteOwnOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord | null> {
    return this.organizationReviewService.getOwn(input);
  }

  async createReview(
    input: UpsertOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    return this.organizationReviewService.create(input);
  }

  async updateOwnReview(
    input: UpsertOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    return this.organizationReviewService.updateOwn(input);
  }

  async deleteOwnReview(
    input: DeleteOwnOrganizationReviewInput,
  ): Promise<DeleteOrganizationReviewResult> {
    return this.organizationReviewService.deleteOwn(input);
  }

  async replyToReview(
    input: ReplyOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    return this.organizationReviewService.reply(input);
  }

  async removeReviewReply(
    input: RemoveOrganizationReviewReplyInput,
  ): Promise<OrganizationReviewRecord> {
    return this.organizationReviewService.removeReply(input);
  }

  async deleteReview(
    input: DeleteOrganizationReviewInput,
  ): Promise<DeleteOrganizationReviewResult> {
    return this.organizationReviewService.delete(input);
  }

  async restoreVersion(
    input: RestoreOrganizationVersionInput,
  ): Promise<RestoreOrganizationVersionResult> {
    const auditLog =
      await this.organizationAuditService.requireRestorableAudit(input);
    const actorMembership = await this.requireMembership(
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
        afterSnapshot = await this.organizationsRepository.updateOrganization(
          input.organizationId,
          {
            name,
            ...this.readProfileFromSnapshot(snapshot),
          },
        );
        action = "organization.restored";
        summary = `Organization restored to ${name}.`;
        break;
      }
      case "member": {
        const snapshot = toAuditSnapshotRecord(auditLog.beforeSnapshot);
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
        const token = this.createInviteToken();
        const invitation = await this.organizationsRepository.reissueInvitation(
          {
            organizationId: input.organizationId,
            invitedByUserId: input.actorUserId,
            email,
            role,
            tokenHash: this.hashInviteToken(token),
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

    if (
      auditLog.resourceType === "organization" &&
      beforeCleanupSnapshot !== undefined
    ) {
      await this.cleanupReplacedOrganizationLogo({
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
  async createOrganization(
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationResult> {
    await this.requireExistingUser(input.actorUserId);

    const profile = pickOrganizationProfileInput(input);
    this.assertOrganizationLogoInput(input.actorUserId, profile);
    const name = input.name.trim();
    const membership = await this.createOrganizationWithUniqueSlug({
      name,
      ownerUserId: input.actorUserId,
      profile,
    });

    await this.organizationsRepository.setPreferredOrganization(
      input.actorUserId,
      membership.id,
    );

    const afterSnapshot = {
      id: membership.id,
      name: membership.name,
      ...profile,
    };
    await this.recordAuditSafely({
      organizationId: membership.id,
      actorUserId: input.actorUserId,
      action: "organization.created",
      resourceType: "organization",
      resourceId: membership.id,
      summary: `${membership.name} was created.`,
      changes: this.createChanges(null, afterSnapshot),
      afterSnapshot,
      restorable: false,
    });

    return {
      organization: {
        id: membership.id,
        slug: membership.slug,
        name: membership.name,
        role: membership.role,
      },
      membership: {
        ...membership,
        isActive: true,
      },
    };
  }

  /**
   * Insert the organization, letting the unique index arbitrate slug
   * collisions.
   *
   * Probing for a free slug before inserting is racy: two concurrent creates
   * with the same name both observe `harbor-rentals` as free and one of them
   * fails on the constraint. Retrying on the constraint violation is what makes
   * concurrent creates correct.
   */
  private async createOrganizationWithUniqueSlug(input: {
    name: string;
    ownerUserId: string;
    profile: OrganizationProfileInput;
  }): Promise<OrganizationMembershipSummary> {
    const base = slugify(input.name, {
      maxLength: ORGANIZATION_SLUG_MAX_LENGTH,
      fallback: "organization",
    });

    for (let attempt = 0; attempt < CREATE_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = nextSlugCandidate(
        base,
        attempt,
        ORGANIZATION_SLUG_MAX_LENGTH,
      );

      // A reserved slug would shadow a sibling route, so skip straight past it
      // rather than letting the database accept it.
      if (isReservedOrganizationSlug(candidate)) {
        continue;
      }

      try {
        return await this.organizationsRepository.createOrganizationWithOwner({
          name: input.name,
          slug: candidate,
          ownerUserId: input.ownerUserId,
          ...input.profile,
        });
      } catch (error) {
        if (!isOrganizationSlugConflict(error)) {
          throw error;
        }
      }
    }

    // Still colliding after the readable candidates; fall back to a short
    // random suffix, then to the id-derived reserved namespace.
    for (let attempt = 0; attempt < CREATE_SLUG_ATTEMPTS; attempt += 1) {
      try {
        return await this.organizationsRepository.createOrganizationWithOwner({
          name: input.name,
          slug: withSuffix(
            base,
            `-${generateShortSlugSuffix()}`,
            ORGANIZATION_SLUG_MAX_LENGTH,
          ),
          ownerUserId: input.ownerUserId,
          ...input.profile,
        });
      } catch (error) {
        if (!isOrganizationSlugConflict(error)) {
          throw error;
        }
      }
    }

    throw new ConflictError("Could not allocate an organization URL.");
  }

  async update(input: UpdateOrganizationInput): Promise<OrganizationSummary> {
    const membership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    this.requirePrimaryManager(membership.role);

    const beforeSnapshot = membership.organization;
    const profile = pickOrganizationProfileInput(input);
    this.assertOrganizationLogoInput(input.actorUserId, profile);
    const updated = await this.organizationsRepository.updateOrganization(
      input.organizationId,
      {
        name: input.name.trim(),
        ...profile,
      },
    );
    const afterSnapshot = {
      ...beforeSnapshot,
      ...updated,
    };

    const nameChanged = beforeSnapshot.name !== updated.name;
    const summary = nameChanged
      ? `Organization renamed from ${beforeSnapshot.name} to ${updated.name}.`
      : `${updated.name} profile was updated.`;

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.renamed",
      resourceType: "organization",
      resourceId: input.organizationId,
      summary,
      changes: this.createChanges(beforeSnapshot, afterSnapshot, [
        ...ORGANIZATION_EDITABLE_FIELDS,
      ]),
      beforeSnapshot,
      afterSnapshot,
      restorable: true,
    });

    await this.cleanupReplacedOrganizationLogo({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      beforeSnapshot,
      afterSnapshot,
    });

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      role: membership.role,
    };
  }

  /**
   * Map a public URL slug (current or retired) onto an organization.
   */
  async resolveBySlug(slug: string): Promise<ResolvedOrganizationReference> {
    const resolved = await this.organizationsRepository.resolveBySlug(slug);

    if (!resolved) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return resolved;
  }

  /**
   * Change an organization's public URL, retiring the previous slug as an
   * alias so existing links keep resolving.
   */
  async changeSlug(
    input: ChangeOrganizationSlugInput,
  ): Promise<OrganizationSummary> {
    const membership = await this.requireMembership(
      input.actorUserId,
      input.organizationId,
    );
    this.requirePrimaryManager(membership.role);

    const previousSlug = membership.organization.slug;
    const nextSlug = input.slug;

    if (previousSlug === nextSlug) {
      return {
        id: membership.organization.id,
        slug: previousSlug,
        name: membership.organization.name,
        role: membership.role,
      };
    }

    // A slug that is in use, or that was ever retired, can never be adopted --
    // not even by the organization that previously held it.
    //
    // Reassigning another organization's slug would point its old links here.
    // Re-adopting one's own retired slug is just as unsafe: after A -> B, a
    // client may hold a cached permanent redirect A -> B, so renaming back to A
    // would make that cache bounce A -> B -> A indefinitely. Aliases are only
    // safe to serve as 308s because they are never reused.
    const existing = await this.organizationsRepository.resolveBySlug(nextSlug);
    if (existing) {
      throw new ConflictError("That organization URL is already taken.");
    }

    let updated;
    try {
      updated = await this.organizationsRepository.changeOrganizationSlug({
        organizationId: input.organizationId,
        previousSlug,
        nextSlug,
      });
    } catch (error) {
      if (isOrganizationSlugConflict(error)) {
        throw new ConflictError("That organization URL is already taken.");
      }

      throw error;
    }

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.slug_changed",
      resourceType: "organization",
      resourceId: input.organizationId,
      summary: `Organization URL changed from ${previousSlug} to ${nextSlug}.`,
      changes: this.createChanges({ slug: previousSlug }, { slug: nextSlug }, [
        "slug",
      ]),
      beforeSnapshot: { slug: previousSlug },
      afterSnapshot: { slug: nextSlug },
      // Restoring would revive a slug that may since have been claimed, so slug
      // changes are audited but not rewindable.
      restorable: false,
    });

    return {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
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

    await this.recordAuditSafely({
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

    await this.recordAuditSafely({
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

    await this.recordAuditSafely({
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

    await this.recordAuditSafely({
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
      await this.organizationsRepository.acceptInvitation({
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

    await this.recordAuditSafely({
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
        slug: invitation.organization.slug,
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

  private assertCanRestoreVersion(
    actorMembership: OrganizationMembershipAccessRecord,
    auditLog: OrganizationAuditRecord,
  ): void {
    switch (auditLog.resourceType) {
      case "organization":
        this.requirePrimaryManager(actorMembership.role);
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
      this.requirePrimaryManager(actorMembership.role);
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

    this.assertCanInvite(actorMembership.role, restoredRole);
  }

  private async recordAuditSafely(
    input: CreateOrganizationAuditLogInput,
  ): Promise<void> {
    try {
      await this.organizationAuditService.record(input);
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

  private async cleanupReplacedOrganizationLogo(input: {
    organizationId: string;
    actorUserId: string;
    beforeSnapshot: unknown;
    afterSnapshot: unknown;
  }): Promise<void> {
    const beforeRecord = toAuditSnapshotRecord(input.beforeSnapshot);
    const afterRecord = toAuditSnapshotRecord(input.afterSnapshot);
    const previousBlobName =
      typeof beforeRecord.logoBlobName === "string"
        ? beforeRecord.logoBlobName
        : null;
    const previousBlobUrl =
      typeof beforeRecord.logoUrl === "string" ? beforeRecord.logoUrl : null;
    const nextBlobName =
      typeof afterRecord.logoBlobName === "string"
        ? afterRecord.logoBlobName
        : null;

    if (
      !previousBlobName ||
      previousBlobName === nextBlobName ||
      !previousBlobUrl ||
      !this.blobService.isManagedBlobUrl(previousBlobUrl, previousBlobName) ||
      !this.isOrganizationLogoBlobName(previousBlobName) ||
      !this.blobService.isBlobOwnedByUser(input.actorUserId, previousBlobName)
    ) {
      return;
    }

    const isReferencedByRestorableAudit =
      await this.organizationAuditService.hasRestorableOrganizationLogoReference(
        {
          organizationId: input.organizationId,
          blobName: previousBlobName,
        },
      );

    if (isReferencedByRestorableAudit) {
      return;
    }

    try {
      await this.blobService.deleteBlob(previousBlobName);
    } catch (error) {
      this.logger.error("Failed to delete replaced organization logo blob.", {
        previousBlobName,
        nextBlobName: nextBlobName ?? undefined,
        error,
      });
    }
  }

  private assertOrganizationLogoInput(
    actorUserId: string,
    profile: OrganizationProfileInput,
  ): void {
    const hasLogoUrl = profile.logoUrl !== undefined;
    const hasLogoBlobName = profile.logoBlobName !== undefined;

    if (hasLogoUrl !== hasLogoBlobName) {
      throw new BadRequestError(
        "Logo URL and logo blob name must be provided together when updating the organization logo.",
      );
    }

    if (!hasLogoUrl && !hasLogoBlobName) {
      return;
    }

    if (!profile.logoUrl && !profile.logoBlobName) {
      return;
    }

    if (!profile.logoUrl || !profile.logoBlobName) {
      throw new BadRequestError(
        "Logo URL and logo blob name must both be set or both be null.",
      );
    }

    const logoBlobName = profile.logoBlobName.trim();

    if (!this.isOrganizationLogoBlobName(logoBlobName)) {
      throw new BadRequestError(
        "Organization logos must use an organizations-scoped blob.",
      );
    }

    if (!this.blobService.isConfigured()) {
      throw new BadRequestError(
        "Organization logos require Blob Storage to be configured on the backend.",
      );
    }

    if (!this.blobService.isManagedBlobUrl(profile.logoUrl, logoBlobName)) {
      throw new BadRequestError(
        "Logo URL must match the Blob Storage location for the provided blob name.",
      );
    }

    if (!this.blobService.isBlobOwnedByUser(actorUserId, logoBlobName)) {
      throw new BadRequestError(
        "Organization logo blob must belong to the current user.",
      );
    }
  }

  private isOrganizationLogoBlobName(blobName: string): boolean {
    return blobName.trim().toLowerCase().startsWith("organizations/");
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

  private createChanges(
    beforeSnapshot: unknown,
    afterSnapshot: unknown,
    fields?: string[],
  ) {
    if (!fields) {
      return buildAuditChanges(beforeSnapshot, afterSnapshot);
    }

    const beforeRecord = toAuditSnapshotRecord(beforeSnapshot);
    const afterRecord = toAuditSnapshotRecord(afterSnapshot);

    return fields
      .filter(
        (key) =>
          JSON.stringify(beforeRecord[key]) !==
          JSON.stringify(afterRecord[key]),
      )
      .map((key) => ({
        field: key,
        before: beforeRecord[key] ?? null,
        after: afterRecord[key] ?? null,
      }));
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

      await this.recordAuditSafely({
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

        await this.recordAuditSafely({
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
