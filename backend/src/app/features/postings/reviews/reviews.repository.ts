import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  ListPostingReviewsResult,
  PostingReviewRecord,
  PostingReviewSummary,
  UpsertPostingReviewInput,
} from "@/features/postings/reviews/reviews.model";

type PostingReviewPersistence = Prisma.PostingReviewGetPayload<{
  include: {
    reviewer: {
      include: {
        profile: true;
      };
    };
  };
}>;

type PostingReviewAggregatePersistence = {
  _avg: {
    rating: number | null;
  };
  _count: {
    _all: number;
  };
};

export class PostingsReviewsRepository extends BaseRepository {
  async create(input: UpsertPostingReviewInput): Promise<PostingReviewRecord> {
    const review = await this.executeAsync(() =>
      this.prisma.postingReview.create({
        data: {
          id: randomUUID(),
          postingId: input.postingId,
          reviewerId: input.reviewerId,
          rating: input.rating,
          title: input.title ?? null,
          comment: input.comment ?? null,
        },
        include: {
          reviewer: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return this.mapReview(review);
  }

  async updateOwnReview(
    input: UpsertPostingReviewInput,
  ): Promise<PostingReviewRecord | null> {
    try {
      const review = await this.executeAsync(() =>
        this.prisma.postingReview.update({
          where: {
            postingId_reviewerId: {
              postingId: input.postingId,
              reviewerId: input.reviewerId,
            },
          },
          data: {
            rating: input.rating,
            title: input.title ?? null,
            comment: input.comment ?? null,
          },
          include: {
            reviewer: {
              include: {
                profile: true,
              },
            },
          },
        }),
      );

      return this.mapReview(review);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return null;
      }

      throw error;
    }
  }

  async findOwnReview(
    postingId: string,
    reviewerId: string,
  ): Promise<PostingReviewRecord | null> {
    const review = await this.executeAsync(() =>
      this.prisma.postingReview.findUnique({
        where: {
          postingId_reviewerId: {
            postingId,
            reviewerId,
          },
        },
        include: {
          reviewer: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return review ? this.mapReview(review) : null;
  }

  async listByPosting(
    postingId: string,
    page: number,
    pageSize: number,
  ): Promise<ListPostingReviewsResult> {
    const skip = (page - 1) * pageSize;

    const [reviews, total, aggregate] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.postingReview.findMany({
          where: {
            postingId,
          },
          skip,
          take: pageSize,
          orderBy: [
            {
              createdAt: "desc",
            },
          ],
          include: {
            reviewer: {
              include: {
                profile: true,
              },
            },
          },
        }),
        this.prisma.postingReview.count({
          where: {
            postingId,
          },
        }),
        this.prisma.postingReview.aggregate({
          where: {
            postingId,
          },
          _avg: {
            rating: true,
          },
          _count: {
            _all: true,
          },
        }),
      ]),
    );

    return {
      reviews: reviews.map((review) => this.mapReview(review)),
      summary: this.mapSummary(aggregate),
      pagination: this.createPagination(page, pageSize, total),
    };
  }

  async getSummary(postingId: string): Promise<PostingReviewSummary> {
    const aggregate = await this.executeAsync(() =>
      this.prisma.postingReview.aggregate({
        where: {
          postingId,
        },
        _avg: {
          rating: true,
        },
        _count: {
          _all: true,
        },
      }),
    );

    return this.mapSummary(aggregate);
  }

  private mapReview(review: PostingReviewPersistence): PostingReviewRecord {
    return {
      id: review.id,
      postingId: review.postingId,
      reviewerId: review.reviewerId,
      rating: review.rating,
      title: review.title ?? undefined,
      comment: review.comment ?? undefined,
      reviewer: {
        username: review.reviewer.profile?.username ?? undefined,
        avatarUrl: review.reviewer.profile?.avatarUrl ?? undefined,
      },
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  async updatePostingRatingStats(postingId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE postings
      SET
        average_rating = (
          SELECT AVG(rating) FROM posting_reviews WHERE posting_id = ${postingId}
        ),
        review_count = (
          SELECT COUNT(*) FROM posting_reviews WHERE posting_id = ${postingId}
        )
      WHERE id = ${postingId}
    `;
  }

  private mapSummary(
    aggregate: PostingReviewAggregatePersistence,
  ): PostingReviewSummary {
    return {
      averageRating: Number((aggregate._avg.rating ?? 0).toFixed(2)),
      reviewCount: aggregate._count._all,
    };
  }

  private createPagination(page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
