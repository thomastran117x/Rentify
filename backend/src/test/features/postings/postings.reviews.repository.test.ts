import { Prisma } from "@/generated/prisma/client";
import { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";

function createReviewPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "review-1",
    postingId: "posting-1",
    reviewerId: "reviewer-1",
    rating: 5,
    title: "Great stay",
    comment: "Exactly as described.",
    reviewer: {
      profile: {
        username: "renter-one",
        avatarUrl: "https://example.test/avatar.png",
      },
    },
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

describe("PostingsReviewsRepository", () => {
  it("creates reviews and maps reviewer profile details", async () => {
    const create = jest.fn(async () => createReviewPersistence());
    const repository = new PostingsReviewsRepository({
      postingReview: {
        create,
      },
    } as any);

    const result = await repository.create({
      postingId: "posting-1",
      reviewerId: "reviewer-1",
      rating: 5,
      title: "Great stay",
      comment: "Exactly as described.",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingId: "posting-1",
          reviewerId: "reviewer-1",
          rating: 5,
        }),
      }),
    );
    expect(result).toEqual({
      id: "review-1",
      postingId: "posting-1",
      reviewerId: "reviewer-1",
      rating: 5,
      title: "Great stay",
      comment: "Exactly as described.",
      reviewer: {
        username: "renter-one",
        avatarUrl: "https://example.test/avatar.png",
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("returns null when updating a missing review hits P2025", async () => {
    const error = Object.assign(new Error("missing review"), {
      code: "P2025",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      error,
      Prisma.PrismaClientKnownRequestError.prototype,
    );
    const update = jest.fn(async () => {
      throw error;
    });
    const repository = new PostingsReviewsRepository({
      postingReview: {
        update,
      },
    } as any);

    await expect(
      repository.updateOwnReview({
        postingId: "posting-1",
        reviewerId: "reviewer-1",
        rating: 4,
      }),
    ).resolves.toBeNull();
  });

  it("finds and maps the current user's review", async () => {
    const findUnique = jest.fn(async () =>
      createReviewPersistence({
        title: null,
        comment: null,
        reviewer: {
          profile: null,
        },
      }),
    );
    const repository = new PostingsReviewsRepository({
      postingReview: {
        findUnique,
      },
    } as any);

    await expect(
      repository.findOwnReview("posting-1", "reviewer-1"),
    ).resolves.toEqual({
      id: "review-1",
      postingId: "posting-1",
      reviewerId: "reviewer-1",
      rating: 5,
      title: undefined,
      comment: undefined,
      reviewer: {
        username: undefined,
        avatarUrl: undefined,
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("lists reviews with summary and pagination metadata", async () => {
    const findMany = jest.fn(async () => [
      createReviewPersistence(),
      createReviewPersistence({
        id: "review-2",
        reviewerId: "reviewer-2",
        rating: 4,
      }),
    ]);
    const count = jest.fn(async () => 7);
    const aggregate = jest.fn(async () => ({
      _avg: {
        rating: 4.3333,
      },
      _count: {
        _all: 7,
      },
    }));
    const repository = new PostingsReviewsRepository({
      postingReview: {
        findMany,
        count,
        aggregate,
      },
    } as any);

    const result = await repository.listByPosting("posting-1", 2, 3);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          postingId: "posting-1",
        },
        skip: 3,
        take: 3,
      }),
    );
    expect(result.summary).toEqual({
      averageRating: 4.33,
      reviewCount: 7,
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 3,
      total: 7,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("returns a summary for a posting with no reviews", async () => {
    const aggregate = jest.fn(async () => ({
      _avg: {
        rating: null,
      },
      _count: {
        _all: 0,
      },
    }));
    const repository = new PostingsReviewsRepository({
      postingReview: {
        aggregate,
      },
    } as any);

    await expect(repository.getSummary("posting-1")).resolves.toEqual({
      averageRating: 0,
      reviewCount: 0,
    });
  });
});
