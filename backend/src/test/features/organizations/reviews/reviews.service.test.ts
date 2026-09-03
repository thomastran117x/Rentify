import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationReviewService } from "@/features/organizations/reviews/reviews.service";
import type {
  ListOrganizationReviewsResult,
  OrganizationReviewRecord,
} from "@/features/organizations/reviews/reviews.model";
import { testUuid } from "../../../support/uuid";
const MISSING_ID = testUuid(9000, 394917);

const ORG_1_ID = testUuid(9000, 9234);
const REVIEW_1_ID = testUuid(9000, 118005);
const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);
const USER_3_ID = testUuid(9000, 994259);

type Role = "primary_manager" | "manager" | "operator";

function createReview(
  overrides: Partial<OrganizationReviewRecord> = {},
): OrganizationReviewRecord {
  return {
    id: REVIEW_1_ID,
    organizationId: ORG_1_ID,
    reviewerId: USER_2_ID,
    rating: 5,
    title: "Great",
    comment: "Loved it",
    reviewer: { username: "renter-two" },
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function createListResult(): ListOrganizationReviewsResult {
  return {
    reviews: [createReview()],
    summary: { averageRating: 5, reviewCount: 1 },
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

function createService(options?: {
  membership?: { role: Role } | null;
  eligible?: boolean;
  existingOwnReview?: OrganizationReviewRecord | null;
  reviewById?: OrganizationReviewRecord | null;
  organizationExists?: boolean;
}) {
  const membership =
    options && "membership" in options ? options.membership : null;
  const eligible = options?.eligible ?? true;
  const existingOwnReview =
    options && "existingOwnReview" in options
      ? options.existingOwnReview
      : null;
  const reviewById =
    options && "reviewById" in options ? options.reviewById : createReview();
  const organizationExists = options?.organizationExists ?? true;

  const repository = {
    organizationExists: jest.fn(async () => organizationExists),
    findOwnReview: jest.fn(async () => existingOwnReview),
    findById: jest.fn(async () => reviewById),
    create: jest.fn(async () => createReview()),
    updateOwnReview: jest.fn(async () => createReview({ rating: 4 })),
    delete: jest.fn(async () => undefined),
    setResponse: jest.fn(async (_orgId, _reviewId, input) =>
      createReview({
        response: input.response
          ? {
              body: input.response,
              respondedAt: "2026-07-17T00:00:00.000Z",
              author: { id: USER_1_ID, username: "owner-one" },
            }
          : undefined,
      }),
    ),
    listByOrganization: jest.fn(async () => createListResult()),
    updateOrganizationRatingStats: jest.fn(async () => undefined),
  };
  const organizationAccessService = {
    findMembership: jest.fn(async () => membership),
    canManage: jest.fn(
      (role: Role) => role === "primary_manager" || role === "manager",
    ),
  };
  const organizationAuditService = {
    record: jest.fn(async () => undefined),
  };
  const rentingsRepository = {
    hasEligibleReviewRentingForOrganization: jest.fn(async () => eligible),
  };

  return {
    repository,
    organizationAccessService,
    organizationAuditService,
    rentingsRepository,
    service: new OrganizationReviewService(
      repository as never,
      organizationAccessService as never,
      organizationAuditService as never,
      rentingsRepository as never,
    ),
  };
}

describe("OrganizationReviewService", () => {
  it("lists reviews for an existing organization", async () => {
    const { service, repository } = createService();

    const result = await service.list({
      organizationId: ORG_1_ID,
      page: 1,
      pageSize: 20,
    });

    expect(repository.listByOrganization).toHaveBeenCalledWith(ORG_1_ID, 1, 20);
    expect(result.summary.reviewCount).toBe(1);
  });

  it("throws when listing reviews for a missing organization", async () => {
    const { service } = createService({ organizationExists: false });

    await expect(
      service.list({ organizationId: MISSING_ID, page: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns the viewer's own review when one exists", async () => {
    const { service, repository } = createService({
      existingOwnReview: createReview(),
    });

    const result = await service.getOwn({
      organizationId: ORG_1_ID,
      reviewerId: USER_2_ID,
    });

    expect(repository.findOwnReview).toHaveBeenCalledWith(ORG_1_ID, USER_2_ID);
    expect(result?.id).toBe(REVIEW_1_ID);
  });

  it("returns null when the viewer has no review", async () => {
    const { service } = createService({ existingOwnReview: null });

    await expect(
      service.getOwn({ organizationId: ORG_1_ID, reviewerId: USER_2_ID }),
    ).resolves.toBeNull();
  });

  it("throws when fetching own review for a missing organization", async () => {
    const { service } = createService({ organizationExists: false });

    await expect(
      service.getOwn({ organizationId: MISSING_ID, reviewerId: USER_2_ID }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("creates a review for an eligible non-member and recomputes stats", async () => {
    const { service, repository } = createService({
      membership: null,
      eligible: true,
    });

    await service.create({
      organizationId: ORG_1_ID,
      reviewerId: USER_2_ID,
      rating: 5,
      title: "Great",
      comment: "Loved it",
    });

    expect(repository.create).toHaveBeenCalled();
    expect(repository.updateOrganizationRatingStats).toHaveBeenCalledWith(
      ORG_1_ID,
    );
  });

  it("rejects reviews from organization members", async () => {
    const { service } = createService({
      membership: { role: "operator" },
      eligible: true,
    });

    await expect(
      service.create({
        organizationId: ORG_1_ID,
        reviewerId: USER_2_ID,
        rating: 5,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects reviews from users without a completed rental", async () => {
    const { service } = createService({ membership: null, eligible: false });

    await expect(
      service.create({
        organizationId: ORG_1_ID,
        reviewerId: USER_2_ID,
        rating: 5,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects duplicate reviews with a conflict error", async () => {
    const { service } = createService({
      membership: null,
      eligible: true,
      existingOwnReview: createReview(),
    });

    await expect(
      service.create({
        organizationId: ORG_1_ID,
        reviewerId: USER_2_ID,
        rating: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates a reviewer's own review", async () => {
    const { service, repository } = createService({
      membership: null,
      eligible: true,
    });

    const result = await service.updateOwn({
      organizationId: ORG_1_ID,
      reviewerId: USER_2_ID,
      rating: 4,
    });

    expect(repository.updateOwnReview).toHaveBeenCalled();
    expect(repository.updateOrganizationRatingStats).toHaveBeenCalledWith(
      ORG_1_ID,
    );
    expect(result.rating).toBe(4);
  });

  it("throws when updating a review that does not exist", async () => {
    const { service, repository } = createService({
      membership: null,
      eligible: true,
    });
    repository.updateOwnReview.mockResolvedValueOnce(
      null as unknown as OrganizationReviewRecord,
    );

    await expect(
      service.updateOwn({
        organizationId: ORG_1_ID,
        reviewerId: USER_2_ID,
        rating: 4,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("deletes a reviewer's own review", async () => {
    const { service, repository } = createService({
      existingOwnReview: createReview(),
    });

    const result = await service.deleteOwn({
      organizationId: ORG_1_ID,
      reviewerId: USER_2_ID,
    });

    expect(repository.delete).toHaveBeenCalledWith(ORG_1_ID, REVIEW_1_ID);
    expect(result).toEqual({ deleted: true, reviewId: REVIEW_1_ID });
  });

  it("throws when deleting an own review that does not exist", async () => {
    const { service } = createService({ existingOwnReview: null });

    await expect(
      service.deleteOwn({ organizationId: ORG_1_ID, reviewerId: USER_2_ID }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("lets a manager reply and records an audit entry", async () => {
    const { service, repository, organizationAuditService } = createService({
      membership: { role: "manager" },
    });

    const result = await service.reply({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      reviewId: REVIEW_1_ID,
      body: "Thanks!",
    });

    expect(repository.setResponse).toHaveBeenCalledWith(
      ORG_1_ID,
      REVIEW_1_ID,
      expect.objectContaining({
        response: "Thanks!",
        responseAuthorId: USER_1_ID,
      }),
    );
    expect(result.response?.body).toBe("Thanks!");
    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "review.replied",
        resourceType: "review",
      }),
    );
  });

  it("rejects replies from operators", async () => {
    const { service } = createService({ membership: { role: "operator" } });

    await expect(
      service.reply({
        organizationId: ORG_1_ID,
        actorUserId: USER_3_ID,
        reviewId: REVIEW_1_ID,
        body: "Thanks!",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects moderation from non-members", async () => {
    const { service } = createService({ membership: null });

    await expect(
      service.delete({
        organizationId: ORG_1_ID,
        actorUserId: USER_3_ID,
        reviewId: REVIEW_1_ID,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("removes a manager reply and records an audit entry", async () => {
    const { service, repository, organizationAuditService } = createService({
      membership: { role: "primary_manager" },
    });

    await service.removeReply({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      reviewId: REVIEW_1_ID,
    });

    expect(repository.setResponse).toHaveBeenCalledWith(
      ORG_1_ID,
      REVIEW_1_ID,
      expect.objectContaining({ response: null, responseAuthorId: null }),
    );
    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "review.reply_removed" }),
    );
  });

  it("lets a manager delete a review, recompute stats, and audit", async () => {
    const { service, repository, organizationAuditService } = createService({
      membership: { role: "manager" },
    });

    const result = await service.delete({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      reviewId: REVIEW_1_ID,
    });

    expect(repository.delete).toHaveBeenCalledWith(ORG_1_ID, REVIEW_1_ID);
    expect(repository.updateOrganizationRatingStats).toHaveBeenCalledWith(
      ORG_1_ID,
    );
    expect(result).toEqual({ deleted: true, reviewId: REVIEW_1_ID });
    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "review.deleted" }),
    );
  });

  it("throws when replying to a missing review", async () => {
    const { service } = createService({
      membership: { role: "manager" },
      reviewById: null,
    });

    await expect(
      service.reply({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        reviewId: MISSING_ID,
        body: "Thanks!",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
