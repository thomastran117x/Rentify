import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  ListOrganizationReviewsResult,
  OrganizationReviewRecord,
  OrganizationReviewSummary,
  SetOrganizationReviewResponsePersistence,
  UpsertOrganizationReviewPersistence,
} from "@/features/organizations/organization-review.model";

type OrganizationReviewPersistence = Prisma.OrganizationReviewGetPayload<{
  include: {
    reviewer: {
      include: {
        profile: true;
      };
    };
    responseAuthor: {
      include: {
        profile: true;
      };
    };
  };
}>;

type OrganizationReviewAggregatePersistence = {
  _avg: {
    rating: number | null;
  };
  _count: {
    _all: number;
  };
};

export class OrganizationReviewRepository extends BaseRepository {
  async create(
    input: UpsertOrganizationReviewPersistence,
  ): Promise<OrganizationReviewRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationReview.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          reviewerId: input.reviewerId,
          rating: input.rating,
          title: input.title,
          comment: input.comment,
        },
        include: this.includeRelations(),
      }),
    );

    return this.mapReview(row);
  }

  async updateOwnReview(
    input: UpsertOrganizationReviewPersistence,
  ): Promise<OrganizationReviewRecord | null> {
    try {
      const row = await this.executeAsync(() =>
        this.prisma.organizationReview.update({
          where: {
            organizationId_reviewerId: {
              organizationId: input.organizationId,
              reviewerId: input.reviewerId,
            },
          },
          data: {
            rating: input.rating,
            title: input.title,
            comment: input.comment,
          },
          include: this.includeRelations(),
        }),
      );

      return this.mapReview(row);
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
    organizationId: string,
    reviewerId: string,
  ): Promise<OrganizationReviewRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationReview.findUnique({
        where: {
          organizationId_reviewerId: {
            organizationId,
            reviewerId,
          },
        },
        include: this.includeRelations(),
      }),
    );

    return row ? this.mapReview(row) : null;
  }

  async findById(
    organizationId: string,
    reviewId: string,
  ): Promise<OrganizationReviewRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationReview.findFirst({
        where: { id: reviewId, organizationId },
        include: this.includeRelations(),
      }),
    );

    return row ? this.mapReview(row) : null;
  }

  async listByOrganization(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<ListOrganizationReviewsResult> {
    const skip = (page - 1) * pageSize;

    const [rows, total, aggregate] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.organizationReview.findMany({
          where: { organizationId },
          skip,
          take: pageSize,
          orderBy: [{ createdAt: "desc" }],
          include: this.includeRelations(),
        }),
        this.prisma.organizationReview.count({
          where: { organizationId },
        }),
        this.prisma.organizationReview.aggregate({
          where: { organizationId },
          _avg: { rating: true },
          _count: { _all: true },
        }),
      ]),
    );

    return {
      reviews: rows.map((row) => this.mapReview(row)),
      summary: this.mapSummary(aggregate),
      pagination: this.createPagination(page, pageSize, total),
    };
  }

  async getSummary(organizationId: string): Promise<OrganizationReviewSummary> {
    const aggregate = await this.executeAsync(() =>
      this.prisma.organizationReview.aggregate({
        where: { organizationId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    );

    return this.mapSummary(aggregate);
  }

  async setResponse(
    organizationId: string,
    reviewId: string,
    input: SetOrganizationReviewResponsePersistence,
  ): Promise<OrganizationReviewRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationReview.update({
        where: { id: reviewId, organizationId },
        data: {
          response: input.response,
          responseAuthorId: input.responseAuthorId,
          respondedAt: input.respondedAt,
        },
        include: this.includeRelations(),
      }),
    );

    return this.mapReview(row);
  }

  async delete(organizationId: string, reviewId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationReview.delete({
        where: { id: reviewId, organizationId },
      }),
    );
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    const organization = await this.executeAsync(() =>
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      }),
    );

    return Boolean(organization);
  }

  async updateOrganizationRatingStats(organizationId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE organizations
      SET
        average_rating = (
          SELECT AVG(rating) FROM organization_reviews WHERE organization_id = ${organizationId}
        ),
        review_count = (
          SELECT COUNT(*) FROM organization_reviews WHERE organization_id = ${organizationId}
        )
      WHERE id = ${organizationId}
    `;
  }

  private includeRelations() {
    return {
      reviewer: {
        include: {
          profile: true,
        },
      },
      responseAuthor: {
        include: {
          profile: true,
        },
      },
    } satisfies Prisma.OrganizationReviewInclude;
  }

  private mapReview(
    row: OrganizationReviewPersistence,
  ): OrganizationReviewRecord {
    const response =
      row.response && row.respondedAt
        ? {
            body: row.response,
            respondedAt: row.respondedAt.toISOString(),
            author: row.responseAuthor
              ? {
                  id: row.responseAuthor.id,
                  username: row.responseAuthor.profile?.username ?? undefined,
                  avatarUrl: row.responseAuthor.profile?.avatarUrl ?? undefined,
                }
              : undefined,
          }
        : undefined;

    return {
      id: row.id,
      organizationId: row.organizationId,
      reviewerId: row.reviewerId,
      rating: row.rating,
      title: row.title ?? undefined,
      comment: row.comment ?? undefined,
      reviewer: {
        username: row.reviewer.profile?.username ?? undefined,
        avatarUrl: row.reviewer.profile?.avatarUrl ?? undefined,
      },
      response,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapSummary(
    aggregate: OrganizationReviewAggregatePersistence,
  ): OrganizationReviewSummary {
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
