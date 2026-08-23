import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationReviewService } from "@/features/organizations/reviews/reviews.service";
import type {
  ListOrganizationReviewsResult,
  OrganizationReviewRecord,
} from "@/features/organizations/reviews/reviews.model";

type Role = "primary_manager" | "manager" | "operator";

function createReview(
  overrides: Partial<OrganizationReviewRecord> = {},
): OrganizationReviewRecord {
  return {
    id: "review-1",
    organizationId: "org-1",
    reviewerId: "user-2",
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
              author: { id: "user-1", username: "owner-one" },
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
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
    });

    expect(repository.listByOrganization).toHaveBeenCalledWith("org-1", 1, 20);
    expect(result.summary.reviewCount).toBe(1);
  });

  it("throws when listing reviews for a missing organization", async () => {
    const { service } = createService({ organizationExists: false });

    await expect(
      service.list({ organizationId: "missing", page: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns the viewer's own review when one exists", async () => {
    const { service, repository } = createService({
      existingOwnReview: createReview(),
    });

    const result = await service.getOwn({
      organizationId: "org-1",
      reviewerId: "user-2",
    });

    expect(repository.findOwnReview).toHaveBeenCalledWith("org-1", "user-2");
    expect(result?.id).toBe("review-1");
  });

  it("returns null when the viewer has no review", async () => {
    const { service } = createService({ existingOwnReview: null });

    await expect(
      service.getOwn({ organizationId: "org-1", reviewerId: "user-2" }),
    ).resolves.toBeNull();
  });

  it("throws when fetching own review for a missing organization", async () => {
    const { service } = createService({ organizationExists: false });

    await expect(
      service.getOwn({ organizationId: "missing", reviewerId: "user-2" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("creates a review for an eligible non-member and recomputes stats", async () => {
    const { service, repository } = createService({
      membership: null,
      eligible: true,
    });

    await service.create({
      organizationId: "org-1",
      reviewerId: "user-2",
      rating: 5,
      title: "Great",
      comment: "Loved it",
    });

    expect(repository.create).toHaveBeenCalled();
    expect(repository.updateOrganizationRatingStats).toHaveBeenCalledWith(
      "org-1",
    );
  });

  it("rejects reviews from organization members", async () => {
    const { service } = createService({
      membership: { role: "operator" },
      eligible: true,
    });

    await expect(
      service.create({
        organizationId: "org-1",
        reviewerId: "user-2",
        rating: 5,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects reviews from users without a completed rental", async () => {
    const { service } = createService({ membership: null, eligible: false });

    await expect(
      service.create({
        organizationId: "org-1",
        reviewerId: "user-2",
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
        organizationId: "org-1",
        reviewerId: "user-2",
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
      organizationId: "org-1",
      reviewerId: "user-2",
      rating: 4,
    });

    expect(repository.updateOwnReview).toHaveBeenCalled();
    expect(repository.updateOrganizationRatingStats).toHaveBeenCalledWith(
      "org-1",
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
        organizationId: "org-1",
        reviewerId: "user-2",
        rating: 4,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("deletes a reviewer's own review", async () => {
    const { service, repository } = createService({
      existingOwnReview: createReview(),
    });

    const result = await service.deleteOwn({
      organizationId: "org-1",
      reviewerId: "user-2",
    });

    expect(repository.delete).toHaveBeenCalledWith("org-1", "review-1");
    expect(result).toEqual({ deleted: true, reviewId: "review-1" });
  });

  it("throws when deleting an own review that does not exist", async () => {
    const { service } = createService({ existingOwnReview: null });

    await expect(
      service.deleteOwn({ organizationId: "org-1", reviewerId: "user-2" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("lets a manager reply and records an audit entry", async () => {
    const { service, repository, organizationAuditService } = createService({
      membership: { role: "manager" },
    });

    const result = await service.reply({
      organizationId: "org-1",
      actorUserId: "user-1",
      reviewId: "review-1",
      body: "Thanks!",
    });

    expect(repository.setResponse).toHaveBeenCalledWith(
      "org-1",
      "review-1",
      expect.objectContaining({
        response: "Thanks!",
        responseAuthorId: "user-1",
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
        organizationId: "org-1",
        actorUserId: "user-3",
        reviewId: "review-1",
        body: "Thanks!",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects moderation from non-members", async () => {
    const { service } = createService({ membership: null });

    await expect(
      service.delete({
        organizationId: "org-1",
        actorUserId: "user-3",
        reviewId: "review-1",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("removes a manager reply and records an audit entry", async () => {
    const { service, repository, organizationAuditService } = createService({
      membership: { role: "primary_manager" },
    });

    await service.removeReply({
      organizationId: "org-1",
      actorUserId: "user-1",
      reviewId: "review-1",
    });

    expect(repository.setResponse).toHaveBeenCalledWith(
      "org-1",
      "review-1",
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
      organizationId: "org-1",
      actorUserId: "user-1",
      reviewId: "review-1",
    });

    expect(repository.delete).toHaveBeenCalledWith("org-1", "review-1");
    expect(repository.updateOrganizationRatingStats).toHaveBeenCalledWith(
      "org-1",
    );
    expect(result).toEqual({ deleted: true, reviewId: "review-1" });
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
        organizationId: "org-1",
        actorUserId: "user-1",
        reviewId: "missing",
        body: "Thanks!",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
