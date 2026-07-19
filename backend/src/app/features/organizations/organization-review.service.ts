import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationReviewRepository } from "@/features/organizations/organization-review.repository";
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
  UpsertOrganizationReviewPersistence,
} from "@/features/organizations/organization-review.model";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import type { CreateOrganizationAuditLogInput } from "@/features/organizations/organization-audit.model";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";

export class OrganizationReviewService {
  private readonly logger = loggerFactory.forClass(
    OrganizationReviewService,
    "service",
  );

  constructor(
    private readonly repository: OrganizationReviewRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly rentingsRepository: RentingsRepository,
  ) {}

  async list(
    input: ListOrganizationReviewsInput,
  ): Promise<ListOrganizationReviewsResult> {
    await this.requireOrganization(input.organizationId);

    return this.repository.listByOrganization(
      input.organizationId,
      input.page,
      input.pageSize,
    );
  }

  async create(
    input: UpsertOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    await this.requireOrganization(input.organizationId);
    await this.assertReviewerIsNotMember(
      input.organizationId,
      input.reviewerId,
    );
    await this.assertReviewerIsEligible(input.organizationId, input.reviewerId);

    const existing = await this.repository.findOwnReview(
      input.organizationId,
      input.reviewerId,
    );

    if (existing) {
      throw new ConflictError("You have already reviewed this organization.");
    }

    const review = await this.repository.create(this.toPersistence(input));
    await this.repository.updateOrganizationRatingStats(input.organizationId);

    return review;
  }

  async updateOwn(
    input: UpsertOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    await this.requireOrganization(input.organizationId);
    await this.assertReviewerIsNotMember(
      input.organizationId,
      input.reviewerId,
    );
    await this.assertReviewerIsEligible(input.organizationId, input.reviewerId);

    const review = await this.repository.updateOwnReview(
      this.toPersistence(input),
    );

    if (!review) {
      throw new ResourceNotFoundError("Review could not be found.");
    }

    await this.repository.updateOrganizationRatingStats(input.organizationId);

    return review;
  }

  async deleteOwn(
    input: DeleteOwnOrganizationReviewInput,
  ): Promise<DeleteOrganizationReviewResult> {
    const existing = await this.repository.findOwnReview(
      input.organizationId,
      input.reviewerId,
    );

    if (!existing) {
      throw new ResourceNotFoundError("Review could not be found.");
    }

    await this.repository.delete(input.organizationId, existing.id);
    await this.repository.updateOrganizationRatingStats(input.organizationId);

    return { deleted: true, reviewId: existing.id };
  }

  async reply(
    input: ReplyOrganizationReviewInput,
  ): Promise<OrganizationReviewRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    await this.requireReview(input.organizationId, input.reviewId);

    const review = await this.repository.setResponse(
      input.organizationId,
      input.reviewId,
      {
        response: input.body,
        responseAuthorId: input.actorUserId,
        respondedAt: new Date(),
      },
    );

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "review.replied",
      resourceType: "review",
      resourceId: review.id,
      summary: "Replied to an organization review.",
    });

    return review;
  }

  async removeReply(
    input: RemoveOrganizationReviewReplyInput,
  ): Promise<OrganizationReviewRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    await this.requireReview(input.organizationId, input.reviewId);

    const review = await this.repository.setResponse(
      input.organizationId,
      input.reviewId,
      {
        response: null,
        responseAuthorId: null,
        respondedAt: null,
      },
    );

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "review.reply_removed",
      resourceType: "review",
      resourceId: review.id,
      summary: "Removed a reply from an organization review.",
    });

    return review;
  }

  async delete(
    input: DeleteOrganizationReviewInput,
  ): Promise<DeleteOrganizationReviewResult> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const existing = await this.requireReview(
      input.organizationId,
      input.reviewId,
    );

    await this.repository.delete(input.organizationId, existing.id);
    await this.repository.updateOrganizationRatingStats(input.organizationId);

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "review.deleted",
      resourceType: "review",
      resourceId: existing.id,
      summary: "Deleted an organization review.",
    });

    return { deleted: true, reviewId: existing.id };
  }

  private async requireOrganization(organizationId: string): Promise<void> {
    const exists = await this.repository.organizationExists(organizationId);

    if (!exists) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }
  }

  private async requireReview(
    organizationId: string,
    reviewId: string,
  ): Promise<OrganizationReviewRecord> {
    const review = await this.repository.findById(organizationId, reviewId);

    if (!review) {
      throw new ResourceNotFoundError("Review could not be found.");
    }

    return review;
  }

  private async assertReviewerIsNotMember(
    organizationId: string,
    reviewerId: string,
  ): Promise<void> {
    const membership = await this.organizationAccessService.findMembership(
      reviewerId,
      organizationId,
    );

    if (membership) {
      throw new ForbiddenError(
        "You cannot review an organization you belong to.",
      );
    }
  }

  private async assertReviewerIsEligible(
    organizationId: string,
    reviewerId: string,
  ): Promise<void> {
    const eligible =
      await this.rentingsRepository.hasEligibleReviewRentingForOrganization({
        organizationId,
        renterId: reviewerId,
        now: new Date(),
      });

    if (!eligible) {
      throw new ForbiddenError(
        "You can only review organizations you have completed a rental with.",
      );
    }
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

    if (!this.organizationAccessService.canManage(membership.role)) {
      throw new ForbiddenError(
        "Only organization managers can moderate reviews.",
      );
    }
  }

  private toPersistence(
    input: UpsertOrganizationReviewInput,
  ): UpsertOrganizationReviewPersistence {
    return {
      organizationId: input.organizationId,
      reviewerId: input.reviewerId,
      rating: input.rating,
      title: input.title?.trim() || null,
      comment: input.comment?.trim() || null,
    };
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
}
