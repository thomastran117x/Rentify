import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  CreatePostingReviewRequestBody,
  ListPostingReviewsResult,
  PostingReviewRecord,
  UpsertPostingReviewInput,
} from "@/features/postings/reviews/reviews.model";
import { isPostingPubliclyVisible } from "@/features/postings/postings.model";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";

export class PostingsReviewsService {
  constructor(
    private readonly postingsReviewsRepository: PostingsReviewsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly rentingsRepository: RentingsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {}

  async create(
    postingId: string,
    reviewerId: string,
    body: CreatePostingReviewRequestBody,
  ): Promise<PostingReviewRecord> {
    const posting = await this.requirePublishedPosting(postingId);
    await this.assertReviewerIsNotOrganizationMember(
      posting.organizationId,
      reviewerId,
    );
    await this.assertReviewerIsEligible(postingId, reviewerId);

    const existing = await this.postingsReviewsRepository.findOwnReview(
      postingId,
      reviewerId,
    );

    if (existing) {
      throw new ConflictError("You have already reviewed this posting.");
    }

    const review = await this.postingsReviewsRepository.create(
      this.toUpsertInput(postingId, reviewerId, body),
    );
    await this.postingsReviewsRepository.updatePostingRatingStats(postingId);
    await invalidatePublicPostingProjection(this.postingsPublicCacheService, postingId);
    await this.postingsRepository.enqueueSearchSync(postingId);
    return review;
  }

  async updateOwn(
    postingId: string,
    reviewerId: string,
    body: CreatePostingReviewRequestBody,
  ): Promise<PostingReviewRecord> {
    const posting = await this.requirePublishedPosting(postingId);
    await this.assertReviewerIsNotOrganizationMember(
      posting.organizationId,
      reviewerId,
    );
    await this.assertReviewerIsEligible(postingId, reviewerId);

    const review = await this.postingsReviewsRepository.updateOwnReview(
      this.toUpsertInput(postingId, reviewerId, body),
    );

    if (!review) {
      throw new ResourceNotFoundError("Review could not be found.");
    }

    await this.postingsReviewsRepository.updatePostingRatingStats(postingId);
    await invalidatePublicPostingProjection(this.postingsPublicCacheService, postingId);
    await this.postingsRepository.enqueueSearchSync(postingId);
    return review;
  }

  async list(
    postingId: string,
    page: number,
    pageSize: number,
  ): Promise<ListPostingReviewsResult> {
    await this.requirePublishedPosting(postingId);
    return this.postingsReviewsRepository.listByPosting(
      postingId,
      page,
      pageSize,
    );
  }

  private async requirePublishedPosting(postingId: string) {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting || !isPostingPubliclyVisible(posting)) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    return posting;
  }

  private async assertReviewerIsNotOrganizationMember(
    organizationId: string,
    reviewerId: string,
  ): Promise<void> {
    const membership = await this.organizationAccessService.findMembership(
      reviewerId,
      organizationId,
    );

    if (membership) {
      throw new ForbiddenError("You cannot review your own posting.");
    }
  }

  private async assertReviewerIsEligible(
    postingId: string,
    reviewerId: string,
  ): Promise<void> {
    const eligible = await this.rentingsRepository.hasEligibleReviewRenting({
      postingId,
      renterId: reviewerId,
      now: new Date(),
    });

    if (!eligible) {
      throw new ForbiddenError(
        "You can only review postings you have completed a rental for.",
      );
    }
  }

  private toUpsertInput(
    postingId: string,
    reviewerId: string,
    body: CreatePostingReviewRequestBody,
  ): UpsertPostingReviewInput {
    return {
      postingId,
      reviewerId,
      rating: body.rating,
      title: body.title?.trim() || null,
      comment: body.comment?.trim() || null,
    };
  }
}
