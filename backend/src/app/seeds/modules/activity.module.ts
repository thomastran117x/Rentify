import { createFixtureId } from "@/seeds/types";
import {
  SEED_ANALYTICS_OUTBOX_EVENTS,
  SEED_ORGANIZATION_REVIEWS,
  SEED_POSTING_REVIEWS,
  SEED_POSTING_VIEW_EVENTS,
  SEED_SAVED_POSTINGS,
} from "@/seeds/fixtures/activity";
import { SEED_BOOKINGS } from "@/seeds/fixtures/bookings";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import type { SeedModule } from "@/seeds/types";

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function startOfHour(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    ),
  );
}

type Aggregate = {
  postingId: string;
  organizationId: string;
  eventDate: Date;
  eventHour: Date;
  views: number;
  uniqueViews: Set<string>;
};

export const activitySeedModule: SeedModule = {
  name: "activity",
  async run({ logger, prisma, state }) {
    const postingIds = SEED_POSTINGS.map((posting) => posting.id);

    await prisma.postingReview.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.savedPosting.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.postingViewEvent.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.postingAnalyticsUniqueView.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.postingAnalyticsHourly.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.postingAnalyticsDaily.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.postingAnalyticsOutbox.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });
    await prisma.postingSearchOutbox.deleteMany({
      where: {
        postingId: {
          in: postingIds,
        },
      },
    });

    for (const review of SEED_POSTING_REVIEWS) {
      const reviewerId = state.userIdsByEmail.get(review.reviewerEmail);

      if (!reviewerId) {
        throw new Error(`Missing seeded reviewer for review ${review.id}.`);
      }

      await prisma.postingReview.create({
        data: {
          id: review.id,
          postingId: review.postingId,
          reviewerId,
          rating: review.rating,
          title: review.title ?? null,
          comment: review.comment ?? null,
          createdAt: new Date(review.createdAt),
        },
      });
    }

    for (const saved of SEED_SAVED_POSTINGS) {
      const userId = state.userIdsByEmail.get(saved.userEmail);

      if (!userId) {
        throw new Error(`Missing seeded user for saved posting ${saved.id}.`);
      }

      await prisma.savedPosting.create({
        data: {
          id: saved.id,
          postingId: saved.postingId,
          userId,
          createdAt: new Date(saved.createdAt),
        },
      });
    }

    const reviewedOrganizationIds = new Set<string>();
    for (const review of SEED_ORGANIZATION_REVIEWS) {
      const organizationId = state.organizationIdsByOwnerEmail.get(
        review.ownerEmail,
      );

      if (!organizationId) {
        throw new Error(`Missing seeded organization for review ${review.id}.`);
      }

      reviewedOrganizationIds.add(organizationId);
    }

    // Clear any existing reviews for the seeded organizations (including ones
    // created at runtime with non-fixture ids) so a refresh is deterministic.
    await prisma.organizationReview.deleteMany({
      where: { organizationId: { in: Array.from(reviewedOrganizationIds) } },
    });

    for (const review of SEED_ORGANIZATION_REVIEWS) {
      const organizationId = state.organizationIdsByOwnerEmail.get(
        review.ownerEmail,
      );
      const reviewerId = state.userIdsByEmail.get(review.reviewerEmail);

      if (!organizationId) {
        throw new Error(`Missing seeded organization for review ${review.id}.`);
      }

      if (!reviewerId) {
        throw new Error(
          `Missing seeded reviewer for organization review ${review.id}.`,
        );
      }

      let responseAuthorId: string | null = null;
      if (review.reply) {
        responseAuthorId =
          state.userIdsByEmail.get(review.reply.authorEmail) ?? null;

        if (!responseAuthorId) {
          throw new Error(
            `Missing seeded reply author for organization review ${review.id}.`,
          );
        }
      }

      await prisma.organizationReview.create({
        data: {
          id: review.id,
          organizationId,
          reviewerId,
          rating: review.rating,
          title: review.title ?? null,
          comment: review.comment ?? null,
          response: review.reply?.body ?? null,
          responseAuthorId,
          respondedAt: review.reply ? new Date(review.reply.respondedAt) : null,
          createdAt: new Date(review.createdAt),
        },
      });
    }

    for (const organizationId of reviewedOrganizationIds) {
      await prisma.$executeRaw`
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

    const uniqueViewKeys = new Set<string>();
    const hourlyAggregateMap = new Map<string, Aggregate>();
    const dailyAggregateMap = new Map<string, Aggregate>();

    for (const viewEvent of SEED_POSTING_VIEW_EVENTS) {
      const organizationId = state.postingOrganizationIdsByPostingId.get(
        viewEvent.postingId,
      );
      const userId = viewEvent.userEmail
        ? state.userIdsByEmail.get(viewEvent.userEmail)
        : undefined;

      if (!organizationId) {
        throw new Error(
          `Missing organization for seeded view event ${viewEvent.id}.`,
        );
      }

      const occurredAt = new Date(viewEvent.occurredAt);
      const eventDate = startOfDay(occurredAt);
      const eventHour = startOfHour(occurredAt);

      await prisma.postingViewEvent.create({
        data: {
          id: viewEvent.id,
          postingId: viewEvent.postingId,
          organizationId,
          viewerHash: viewEvent.viewerHash,
          userId: userId ?? null,
          ipAddressHash: viewEvent.ipAddressHash ?? null,
          userAgentHash: viewEvent.userAgentHash ?? null,
          deviceType: viewEvent.deviceType,
          occurredAt,
          eventDate,
          eventHour,
        },
      });

      const uniqueKey = `${viewEvent.postingId}:${viewEvent.viewerHash}:${eventDate.toISOString()}`;
      if (!uniqueViewKeys.has(uniqueKey)) {
        uniqueViewKeys.add(uniqueKey);
        await prisma.postingAnalyticsUniqueView.create({
          data: {
            postingId: viewEvent.postingId,
            organizationId,
            viewerHash: viewEvent.viewerHash,
            eventDate,
          },
        });
      }

      const hourlyKey = `${viewEvent.postingId}:${eventHour.toISOString()}`;
      const dailyKey = `${viewEvent.postingId}:${eventDate.toISOString()}`;

      const hourlyAggregate = hourlyAggregateMap.get(hourlyKey) ?? {
        postingId: viewEvent.postingId,
        organizationId,
        eventDate,
        eventHour,
        views: 0,
        uniqueViews: new Set<string>(),
      };
      hourlyAggregate.views += 1;
      hourlyAggregate.uniqueViews.add(viewEvent.viewerHash);
      hourlyAggregateMap.set(hourlyKey, hourlyAggregate);

      const dailyAggregate = dailyAggregateMap.get(dailyKey) ?? {
        postingId: viewEvent.postingId,
        organizationId,
        eventDate,
        eventHour,
        views: 0,
        uniqueViews: new Set<string>(),
      };
      dailyAggregate.views += 1;
      dailyAggregate.uniqueViews.add(viewEvent.viewerHash);
      dailyAggregateMap.set(dailyKey, dailyAggregate);
    }

    const bookingCountByPostingId = new Map<string, number>();
    const confirmedCountByPostingId = new Map<string, number>();
    const confirmedRevenueByPostingId = new Map<string, number>();
    const refundedRevenueByPostingId = new Map<string, number>();

    for (const booking of SEED_BOOKINGS) {
      bookingCountByPostingId.set(
        booking.postingId,
        (bookingCountByPostingId.get(booking.postingId) ?? 0) + 1,
      );

      if (booking.renting) {
        confirmedCountByPostingId.set(
          booking.postingId,
          (confirmedCountByPostingId.get(booking.postingId) ?? 0) + 1,
        );
      }

      if (["paid", "refunded"].includes(booking.status)) {
        confirmedRevenueByPostingId.set(
          booking.postingId,
          (confirmedRevenueByPostingId.get(booking.postingId) ?? 0) +
            booking.estimatedTotal,
        );
      }

      if (booking.status === "refunded") {
        refundedRevenueByPostingId.set(
          booking.postingId,
          (refundedRevenueByPostingId.get(booking.postingId) ?? 0) +
            booking.estimatedTotal,
        );
      }
    }

    let hourlyIndex = 1;
    for (const aggregate of hourlyAggregateMap.values()) {
      await prisma.postingAnalyticsHourly.create({
        data: {
          id: createFixtureId(4040, hourlyIndex),
          postingId: aggregate.postingId,
          organizationId: aggregate.organizationId,
          bucketStart: aggregate.eventHour,
          searchImpressions: 0,
          searchClicks: 0,
          views: aggregate.views,
          uniqueViews: aggregate.uniqueViews.size,
          bookingRequests:
            bookingCountByPostingId.get(aggregate.postingId) ?? 0,
          approvedRequests: 0,
          declinedRequests: 0,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings:
            confirmedCountByPostingId.get(aggregate.postingId) ?? 0,
          estimatedConfirmedRevenue:
            confirmedRevenueByPostingId.get(aggregate.postingId) ?? 0,
          refundedRevenue:
            refundedRevenueByPostingId.get(aggregate.postingId) ?? 0,
        },
      });
      hourlyIndex += 1;
    }

    let dailyIndex = 1;
    for (const aggregate of dailyAggregateMap.values()) {
      await prisma.postingAnalyticsDaily.create({
        data: {
          id: createFixtureId(4050, dailyIndex),
          postingId: aggregate.postingId,
          organizationId: aggregate.organizationId,
          bucketStart: aggregate.eventDate,
          searchImpressions: 0,
          searchClicks: 0,
          views: aggregate.views,
          uniqueViews: aggregate.uniqueViews.size,
          bookingRequests:
            bookingCountByPostingId.get(aggregate.postingId) ?? 0,
          approvedRequests: 0,
          declinedRequests: 0,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings:
            confirmedCountByPostingId.get(aggregate.postingId) ?? 0,
          estimatedConfirmedRevenue:
            confirmedRevenueByPostingId.get(aggregate.postingId) ?? 0,
          refundedRevenue:
            refundedRevenueByPostingId.get(aggregate.postingId) ?? 0,
        },
      });
      dailyIndex += 1;
    }

    for (const event of SEED_ANALYTICS_OUTBOX_EVENTS) {
      const organizationId = state.postingOrganizationIdsByPostingId.get(
        event.postingId,
      );

      if (!organizationId) {
        throw new Error(
          `Missing organization for analytics outbox event ${event.id}.`,
        );
      }

      await prisma.postingAnalyticsOutbox.create({
        data: {
          id: event.id,
          postingId: event.postingId,
          organizationId,
          eventType: event.eventType,
          payload: event.payload as never,
          attempts: event.attempts ?? 0,
          availableAt: new Date(event.availableAt),
          processedAt: event.processedAt ? new Date(event.processedAt) : null,
          lastError: event.lastError ?? null,
        },
      });
    }

    for (const [index, posting] of SEED_POSTINGS.entries()) {
      await prisma.postingSearchOutbox.create({
        data: {
          id: createFixtureId(4060, index + 1),
          postingId: posting.id,
          operation: posting.status === "published" ? "upsert" : "delete",
          dedupeKey: `seed-search:${posting.id}`,
          availableAt: new Date(
            `2026-04-25T${String(8 + (index % 10)).padStart(2, "0")}:00:00.000Z`,
          ),
        },
      });
    }

    logger.info("Seeded reviews, search outbox rows, and analytics fixtures.");
  },
};
