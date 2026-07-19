import { Prisma } from "@prisma/client";
import { OrganizationReviewRepository } from "@/features/organizations/organization-review.repository";

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "review-1",
    organizationId: "org-1",
    reviewerId: "user-2",
    rating: 5,
    title: "Great",
    comment: "Loved it",
    response: null,
    responseAuthorId: null,
    respondedAt: null,
    reviewer: {
      id: "user-2",
      profile: {
        username: "renter-two",
        avatarUrl: "https://example.test/avatar.png",
      },
    },
    responseAuthor: null,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("OrganizationReviewRepository", () => {
  it("creates and maps a review without a response", async () => {
    const create = jest.fn(async () => buildRow());
    const repository = new OrganizationReviewRepository({
      organizationReview: { create },
    } as never);

    const result = await repository.create({
      organizationId: "org-1",
      reviewerId: "user-2",
      rating: 5,
      title: "Great",
      comment: "Loved it",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          reviewerId: "user-2",
          rating: 5,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "review-1",
        rating: 5,
        reviewer: {
          username: "renter-two",
          avatarUrl: "https://example.test/avatar.png",
        },
        response: undefined,
      }),
    );
  });

  it("maps a review with a manager response", async () => {
    const findFirst = jest.fn(async () =>
      buildRow({
        response: "Thanks!",
        respondedAt: new Date("2026-07-17T00:00:00.000Z"),
        responseAuthor: {
          id: "user-1",
          profile: { username: "owner-one", avatarUrl: null },
        },
      }),
    );
    const repository = new OrganizationReviewRepository({
      organizationReview: { findFirst },
    } as never);

    const result = await repository.findById("org-1", "review-1");

    expect(result?.response).toEqual({
      body: "Thanks!",
      respondedAt: "2026-07-17T00:00:00.000Z",
      author: { id: "user-1", username: "owner-one", avatarUrl: undefined },
    });
  });

  it("returns null when updating a review that no longer exists", async () => {
    const update = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("missing", {
        code: "P2025",
        clientVersion: "6.0.0",
      });
    });
    const repository = new OrganizationReviewRepository({
      organizationReview: { update },
    } as never);

    await expect(
      repository.updateOwnReview({
        organizationId: "org-1",
        reviewerId: "user-2",
        rating: 4,
        title: null,
        comment: null,
      }),
    ).resolves.toBeNull();
  });

  it("re-throws unexpected update errors", async () => {
    const update = jest.fn(async () => {
      throw new Error("boom");
    });
    const repository = new OrganizationReviewRepository({
      organizationReview: { update },
    } as never);

    await expect(
      repository.updateOwnReview({
        organizationId: "org-1",
        reviewerId: "user-2",
        rating: 4,
        title: null,
        comment: null,
      }),
    ).rejects.toThrow("boom");
  });

  it("lists reviews with a rating summary and pagination", async () => {
    const findMany = jest.fn(async () => [buildRow()]);
    const count = jest.fn(async () => 1);
    const aggregate = jest.fn(async () => ({
      _avg: { rating: 4.5 },
      _count: { _all: 1 },
    }));
    const repository = new OrganizationReviewRepository({
      organizationReview: { findMany, count, aggregate },
    } as never);

    const result = await repository.listByOrganization("org-1", 1, 20);

    expect(result.summary).toEqual({ averageRating: 4.5, reviewCount: 1 });
    expect(result.reviews).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it("returns a zeroed summary when there are no reviews", async () => {
    const aggregate = jest.fn(async () => ({
      _avg: { rating: null },
      _count: { _all: 0 },
    }));
    const repository = new OrganizationReviewRepository({
      organizationReview: { aggregate },
    } as never);

    const summary = await repository.getSummary("org-1");

    expect(summary).toEqual({ averageRating: 0, reviewCount: 0 });
  });

  it("sets a response scoped to the organization", async () => {
    const update = jest.fn(async () =>
      buildRow({
        response: "Thanks!",
        respondedAt: new Date("2026-07-17T00:00:00.000Z"),
        responseAuthor: { id: "user-1", profile: { username: "owner-one" } },
      }),
    );
    const repository = new OrganizationReviewRepository({
      organizationReview: { update },
    } as never);

    await repository.setResponse("org-1", "review-1", {
      response: "Thanks!",
      responseAuthorId: "user-1",
      respondedAt: new Date("2026-07-17T00:00:00.000Z"),
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "review-1", organizationId: "org-1" },
        data: expect.objectContaining({ response: "Thanks!" }),
      }),
    );
  });

  it("deletes a review scoped to its organization", async () => {
    const deleteFn = jest.fn(async () => buildRow());
    const repository = new OrganizationReviewRepository({
      organizationReview: { delete: deleteFn },
    } as never);

    await repository.delete("org-1", "review-1");

    expect(deleteFn).toHaveBeenCalledWith({
      where: { id: "review-1", organizationId: "org-1" },
    });
  });

  it("reports whether an organization exists", async () => {
    const findUnique = jest.fn(async () => ({ id: "org-1" }));
    const repository = new OrganizationReviewRepository({
      organization: { findUnique },
    } as never);

    await expect(repository.organizationExists("org-1")).resolves.toBe(true);

    findUnique.mockResolvedValueOnce(null as never);
    await expect(repository.organizationExists("missing")).resolves.toBe(false);
  });

  it("recomputes organization rating stats via raw SQL", async () => {
    const executeRaw = jest.fn(async () => 1);
    const repository = new OrganizationReviewRepository({
      $executeRaw: executeRaw,
    } as never);

    await repository.updateOrganizationRatingStats("org-1");

    expect(executeRaw).toHaveBeenCalled();
  });

  it("finds a reviewer's own review by unique key", async () => {
    const findUnique = jest.fn(async () => buildRow());
    const repository = new OrganizationReviewRepository({
      organizationReview: { findUnique },
    } as never);

    const result = await repository.findOwnReview("org-1", "user-2");

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_reviewerId: {
            organizationId: "org-1",
            reviewerId: "user-2",
          },
        },
      }),
    );
    expect(result?.id).toBe("review-1");
  });
});
