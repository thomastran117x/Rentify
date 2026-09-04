import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  EnqueueBookingApprovedEventInput,
  EnqueueBookingCancelledEventInput,
  EnqueueBookingDeclinedEventInput,
  EnqueueBookingExpiredEventInput,
  EnqueueBookingRequestedEventInput,
  EnqueuePaymentFailedEventInput,
  EnqueuePostingViewedEventInput,
  EnqueueRefundRecordedEventInput,
  EnqueueRentingConfirmedEventInput,
  EnqueueSearchClickEventInput,
  EnqueueSearchImpressionEventInput,
  ListPostingAnalyticsPersistenceInput,
  OwnerPostingsAnalyticsSummary,
  PostingAnalyticsBucket,
  PostingAnalyticsBucketMetrics,
  PostingAnalyticsDataAvailability,
  PostingAnalyticsDerivedMetrics,
  PostingAnalyticsDetail,
  PostingAnalyticsDetailPersistenceInput,
  PostingAnalyticsEventType,
  PostingAnalyticsListItem,
  PostingAnalyticsListResult,
  PostingAnalyticsMetrics,
  PostingAnalyticsOutboxRecord,
  PostingAnalyticsSummaryPersistenceInput,
  PostingAnalyticsWindow,
  ProcessBookingApprovedEventInput,
  ProcessBookingCancelledEventInput,
  ProcessBookingDeclinedEventInput,
  ProcessBookingExpiredEventInput,
  ProcessBookingRequestedEventInput,
  ProcessPaymentFailedEventInput,
  ProcessPostingViewedEventInput,
  ProcessRefundRecordedEventInput,
  ProcessRentingConfirmedEventInput,
  ProcessSearchClickEventInput,
  ProcessSearchImpressionEventInput,
} from "@/features/postings/analytics/analytics.model";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

interface AnalyticsAggregateRow {
  searchImpressions: bigint | number | null;
  searchClicks: bigint | number | null;
  views: bigint | number | null;
  uniqueViews: bigint | number | null;
  bookingRequests: bigint | number | null;
  approvedRequests: bigint | number | null;
  declinedRequests: bigint | number | null;
  expiredRequests: bigint | number | null;
  cancelledRequests: bigint | number | null;
  paymentFailedRequests: bigint | number | null;
  confirmedBookings: bigint | number | null;
  estimatedConfirmedRevenue: Prisma.Decimal | number | string | null;
  refundedRevenue: Prisma.Decimal | number | string | null;
}

interface AnalyticsCountRow {
  total: bigint | number;
}

interface PostingAnalyticsListRow extends AnalyticsAggregateRow {
  postingId: Uuid;
  name: string;
  status: string;
  primaryPhotoUrl: string | null;
  publishedAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
}

interface PostingAnalyticsBucketRow extends AnalyticsAggregateRow {
  bucketStart: Date;
}

interface PostingAnalyticsHeaderRow {
  postingId: Uuid;
  name: string;
  status: string;
  primaryPhotoUrl: string | null;
  publishedAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
}

interface PostingOperationalStateRow {
  postingId: Uuid;
  status: string;
  publishedAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
}

interface PostingTimeSpanRow {
  postingId: Uuid;
  startAt: Date;
  endAt: Date;
}

interface PostingOperationalMetrics {
  activeDaysPublished: number;
  calendarBlockedDays: number;
  confirmedBookedDays: number;
}

type AnalyticsOutboxPersistence =
  Prisma.PostingAnalyticsOutboxGetPayload<object>;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export class PostingsAnalyticsRepository extends BaseRepository {
  async enqueuePostingViewedEvent(
    input: EnqueuePostingViewedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "posting_viewed",
      {
        occurredAt: input.occurredAt,
        viewerHash: input.viewerHash,
        userId: input.userId ?? null,
        ipAddressHash: input.ipAddressHash ?? null,
        userAgentHash: input.userAgentHash ?? null,
        deviceType: input.deviceType,
      },
    );
  }

  async enqueueSearchImpressionEvent(
    input: EnqueueSearchImpressionEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "search_impression",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueueSearchClickEvent(
    input: EnqueueSearchClickEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "search_click",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueueBookingRequestedEvent(
    input: EnqueueBookingRequestedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "booking_requested",
      {
        occurredAt: input.occurredAt,
        estimatedTotal: input.estimatedTotal,
      },
    );
  }

  async enqueueBookingApprovedEvent(
    input: EnqueueBookingApprovedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "booking_approved",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueueBookingDeclinedEvent(
    input: EnqueueBookingDeclinedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "booking_declined",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueueBookingExpiredEvent(
    input: EnqueueBookingExpiredEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "booking_expired",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueueBookingCancelledEvent(
    input: EnqueueBookingCancelledEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "booking_cancelled",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueuePaymentFailedEvent(
    input: EnqueuePaymentFailedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "payment_failed",
      {
        occurredAt: input.occurredAt,
      },
    );
  }

  async enqueueRefundRecordedEvent(
    input: EnqueueRefundRecordedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "refund_recorded",
      {
        occurredAt: input.occurredAt,
        refundedAmount: input.refundedAmount,
      },
    );
  }

  async enqueueRentingConfirmedEvent(
    input: EnqueueRentingConfirmedEventInput,
  ): Promise<void> {
    await this.enqueueOutboxEvent(
      input.postingId,
      input.organizationId,
      "renting_confirmed",
      {
        occurredAt: input.occurredAt,
        estimatedTotal: input.estimatedTotal,
      },
    );
  }

  async claimOutboxBatch(
    limit: number,
  ): Promise<PostingAnalyticsOutboxRecord[]> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const candidates = await this.prisma.postingAnalyticsOutbox.findMany({
        where: {
          processedAt: null,
          availableAt: {
            lte: now,
          },
          OR: [
            {
              processingAt: null,
            },
            {
              processingAt: {
                lt: staleProcessingThreshold,
              },
            },
          ],
        },
        orderBy: [
          {
            availableAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        take: limit,
      });

      const claimed: PostingAnalyticsOutboxRecord[] = [];

      for (const candidate of candidates) {
        const result = await this.prisma.postingAnalyticsOutbox.updateMany({
          where: {
            id: candidate.id,
            processedAt: null,
            OR: [
              {
                processingAt: null,
              },
              {
                processingAt: {
                  lt: staleProcessingThreshold,
                },
              },
            ],
          },
          data: {
            processingAt: now,
          },
        });

        if (result.count === 1) {
          claimed.push(this.mapOutbox(candidate, now));
        }
      }

      return claimed;
    });
  }

  async markOutboxProcessed(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.postingAnalyticsOutbox.update({
        where: {
          id,
        },
        data: {
          processedAt: new Date(),
          processingAt: null,
          lastError: null,
        },
      }),
    );
  }

  async markOutboxRetry(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    const backoffSeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await this.executeAsync(() =>
      this.prisma.postingAnalyticsOutbox.update({
        where: {
          id,
        },
        data: {
          attempts: {
            increment: 1,
          },
          processingAt: null,
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async processPostingViewedEvent(
    input: ProcessPostingViewedEventInput,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const occurredAt = new Date(input.occurredAt);
        const eventDate = new Date(input.eventDate);
        const eventHour = new Date(input.eventHour);

        await transaction.postingViewEvent.create({
          data: {
            id: newUuid(),
            postingId: input.postingId,
            organizationId: input.organizationId,
            viewerHash: input.viewerHash,
            userId: input.userId ?? null,
            ipAddressHash: input.ipAddressHash ?? null,
            userAgentHash: input.userAgentHash ?? null,
            deviceType: input.deviceType,
            occurredAt,
            eventDate,
            eventHour,
          },
        });

        const uniqueInsert =
          await transaction.postingAnalyticsUniqueView.createMany({
            data: [
              {
                postingId: input.postingId,
                organizationId: input.organizationId,
                viewerHash: input.viewerHash,
                eventDate,
              },
            ],
            skipDuplicates: true,
          });
        const uniqueIncrement = uniqueInsert.count > 0 ? 1 : 0;

        await this.incrementHourlyMetrics(
          transaction,
          input.postingId,
          input.organizationId,
          eventHour,
          {
            views: 1,
            uniqueViews: uniqueIncrement,
          },
        );
        await this.incrementDailyMetrics(
          transaction,
          input.postingId,
          input.organizationId,
          eventDate,
          {
            views: 1,
            uniqueViews: uniqueIncrement,
          },
        );
      }),
    );
  }

  async processSearchImpressionEvent(
    input: ProcessSearchImpressionEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        searchImpressions: 1,
      },
    );
  }

  async processSearchClickEvent(
    input: ProcessSearchClickEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        searchClicks: 1,
      },
    );
  }

  async processBookingRequestedEvent(
    input: ProcessBookingRequestedEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        bookingRequests: 1,
      },
    );
  }

  async processBookingApprovedEvent(
    input: ProcessBookingApprovedEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        approvedRequests: 1,
      },
    );
  }

  async processBookingDeclinedEvent(
    input: ProcessBookingDeclinedEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        declinedRequests: 1,
      },
    );
  }

  async processBookingExpiredEvent(
    input: ProcessBookingExpiredEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        expiredRequests: 1,
      },
    );
  }

  async processBookingCancelledEvent(
    input: ProcessBookingCancelledEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        cancelledRequests: 1,
      },
    );
  }

  async processPaymentFailedEvent(
    input: ProcessPaymentFailedEventInput,
  ): Promise<void> {
    await this.processSimpleCounterEvent(
      input.postingId,
      input.organizationId,
      input.eventDate,
      input.eventHour,
      {
        paymentFailedRequests: 1,
      },
    );
  }

  async processRefundRecordedEvent(
    input: ProcessRefundRecordedEventInput,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const eventDate = new Date(input.eventDate);
        const eventHour = new Date(input.eventHour);
        const refundedAmount = new Prisma.Decimal(input.refundedAmount);

        await this.incrementHourlyMetrics(
          transaction,
          input.postingId,
          input.organizationId,
          eventHour,
          {
            refundedRevenue: refundedAmount,
          },
        );
        await this.incrementDailyMetrics(
          transaction,
          input.postingId,
          input.organizationId,
          eventDate,
          {
            refundedRevenue: refundedAmount,
          },
        );
      }),
    );
  }

  async processRentingConfirmedEvent(
    input: ProcessRentingConfirmedEventInput,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const eventDate = new Date(input.eventDate);
        const eventHour = new Date(input.eventHour);
        const estimatedTotal = new Prisma.Decimal(input.estimatedTotal);

        await this.incrementHourlyMetrics(
          transaction,
          input.postingId,
          input.organizationId,
          eventHour,
          {
            confirmedBookings: 1,
            estimatedConfirmedRevenue: estimatedTotal,
          },
        );
        await this.incrementDailyMetrics(
          transaction,
          input.postingId,
          input.organizationId,
          eventDate,
          {
            confirmedBookings: 1,
            estimatedConfirmedRevenue: estimatedTotal,
          },
        );
      }),
    );
  }

  async getOwnerSummary(
    input: PostingAnalyticsSummaryPersistenceInput,
  ): Promise<OwnerPostingsAnalyticsSummary> {
    const tableSql = this.dailyTableSql();
    const range = this.createWindowRange(input.window);
    const whereSql = Prisma.sql`
      organization_id = ${input.organizationId}
      ${range.startAt ? Prisma.sql`AND bucket_start >= ${range.startAt}` : Prisma.empty}
    `;
    const [row, operationalRows] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.$queryRaw<AnalyticsAggregateRow[]>(Prisma.sql`
          SELECT
            COALESCE(SUM(search_impressions), 0) AS searchImpressions,
            COALESCE(SUM(search_clicks), 0) AS searchClicks,
            COALESCE(SUM(views), 0) AS views,
            COALESCE(SUM(unique_views), 0) AS uniqueViews,
            COALESCE(SUM(booking_requests), 0) AS bookingRequests,
            COALESCE(SUM(approved_requests), 0) AS approvedRequests,
            COALESCE(SUM(declined_requests), 0) AS declinedRequests,
            COALESCE(SUM(expired_requests), 0) AS expiredRequests,
            COALESCE(SUM(cancelled_requests), 0) AS cancelledRequests,
            COALESCE(SUM(payment_failed_requests), 0) AS paymentFailedRequests,
            COALESCE(SUM(confirmed_bookings), 0) AS confirmedBookings,
            COALESCE(SUM(estimated_confirmed_revenue), 0) AS estimatedConfirmedRevenue,
            COALESCE(SUM(refunded_revenue), 0) AS refundedRevenue
          FROM ${tableSql}
          WHERE ${whereSql}
        `),
        this.listOperationalPostingStatesByOrganization(input.organizationId),
      ]),
    );

    const operationalMetrics = await this.getOperationalMetricsMap(
      operationalRows,
      range,
    );
    const totals = this.combineMetrics(
      this.mapBucketMetrics(row[0]),
      this.sumOperationalMetrics(operationalMetrics.values()),
    );

    return {
      window: input.window,
      totals,
      derivedMetrics: this.createDerivedMetrics(totals),
      dataAvailability: this.createDataAvailability(),
      range: this.mapRange(range.startAt, range.endAt),
    };
  }

  async listOwnerPostingsAnalytics(
    input: ListPostingAnalyticsPersistenceInput,
  ): Promise<PostingAnalyticsListResult> {
    const range = this.createWindowRange(input.window);
    const skip = (input.page - 1) * input.pageSize;
    const tableSql = this.dailyTableSql();
    const whereSql = Prisma.sql`
      ra.organization_id = ${input.organizationId}
      ${range.startAt ? Prisma.sql`AND ra.bucket_start >= ${range.startAt}` : Prisma.empty}
    `;

    const [rows, countRows] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.$queryRaw<PostingAnalyticsListRow[]>(Prisma.sql`
          SELECT
            ra.posting_id AS postingId,
            r.name AS name,
            r.status AS status,
            (
              SELECT rp.blob_url
              FROM posting_photos rp
              WHERE rp.posting_id = ra.posting_id
              ORDER BY rp.position ASC
              LIMIT 1
            ) AS primaryPhotoUrl,
            r.published_at AS publishedAt,
            r.paused_at AS pausedAt,
            r.archived_at AS archivedAt,
            COALESCE(SUM(ra.search_impressions), 0) AS searchImpressions,
            COALESCE(SUM(ra.search_clicks), 0) AS searchClicks,
            COALESCE(SUM(ra.views), 0) AS views,
            COALESCE(SUM(ra.unique_views), 0) AS uniqueViews,
            COALESCE(SUM(ra.booking_requests), 0) AS bookingRequests,
            COALESCE(SUM(ra.approved_requests), 0) AS approvedRequests,
            COALESCE(SUM(ra.declined_requests), 0) AS declinedRequests,
            COALESCE(SUM(ra.expired_requests), 0) AS expiredRequests,
            COALESCE(SUM(ra.cancelled_requests), 0) AS cancelledRequests,
            COALESCE(SUM(ra.payment_failed_requests), 0) AS paymentFailedRequests,
            COALESCE(SUM(ra.confirmed_bookings), 0) AS confirmedBookings,
            COALESCE(SUM(ra.estimated_confirmed_revenue), 0) AS estimatedConfirmedRevenue,
            COALESCE(SUM(ra.refunded_revenue), 0) AS refundedRevenue
          FROM ${tableSql} ra
          INNER JOIN postings r ON r.id = ra.posting_id
          WHERE ${whereSql}
          GROUP BY
            ra.posting_id,
            r.name,
            r.status,
            r.published_at,
            r.paused_at,
            r.archived_at
          ORDER BY confirmedBookings DESC, bookingRequests DESC, views DESC, r.updated_at DESC
          LIMIT ${input.pageSize}
          OFFSET ${skip}
        `),
        this.prisma.$queryRaw<AnalyticsCountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS total
          FROM (
            SELECT ra.posting_id
            FROM ${tableSql} ra
            WHERE ${whereSql}
            GROUP BY ra.posting_id
          ) AS grouped_postings
        `),
      ]),
    );

    const total = Number(countRows[0]?.total ?? 0);
    const postingStates = rows.map((row) => this.toOperationalState(row));
    const operationalMap = await this.getOperationalMetricsMap(
      postingStates,
      range,
    );

    return {
      window: input.window,
      postings: rows.map((row): PostingAnalyticsListItem => {
        const totals = this.combineMetrics(
          this.mapBucketMetrics(row),
          operationalMap.get(row.postingId) ??
            this.createEmptyOperationalMetrics(),
        );

        return {
          postingId: row.postingId,
          name: row.name,
          status: row.status,
          primaryPhotoUrl: row.primaryPhotoUrl ?? undefined,
          totals,
          derivedMetrics: this.createDerivedMetrics(totals),
        };
      }),
      pagination: this.createPagination(input.page, input.pageSize, total),
      dataAvailability: this.createDataAvailability(),
      range: this.mapRange(range.startAt, range.endAt),
    };
  }

  async getPostingAnalyticsDetail(
    input: PostingAnalyticsDetailPersistenceInput,
  ): Promise<PostingAnalyticsDetail | null> {
    const header = await this.findPostingAnalyticsHeader(
      input.postingId,
      input.organizationId,
    );

    if (!header) {
      return null;
    }

    const range = this.createWindowRange(input.window);
    const totalsTable = this.dailyTableSql();
    const detailTable =
      input.granularity === "hour"
        ? this.hourlyTableSql()
        : this.dailyTableSql();
    const whereTotalsSql = Prisma.sql`
      posting_id = ${input.postingId}
      AND organization_id = ${input.organizationId}
      ${range.startAt ? Prisma.sql`AND bucket_start >= ${range.startAt}` : Prisma.empty}
    `;

    const [totalRows, bucketRows, operationalMap] = await this.executeAsync(
      async () => {
        const [totals, buckets, operational] = await Promise.all([
          this.prisma.$queryRaw<AnalyticsAggregateRow[]>(Prisma.sql`
          SELECT
            COALESCE(SUM(search_impressions), 0) AS searchImpressions,
            COALESCE(SUM(search_clicks), 0) AS searchClicks,
            COALESCE(SUM(views), 0) AS views,
            COALESCE(SUM(unique_views), 0) AS uniqueViews,
            COALESCE(SUM(booking_requests), 0) AS bookingRequests,
            COALESCE(SUM(approved_requests), 0) AS approvedRequests,
            COALESCE(SUM(declined_requests), 0) AS declinedRequests,
            COALESCE(SUM(expired_requests), 0) AS expiredRequests,
            COALESCE(SUM(cancelled_requests), 0) AS cancelledRequests,
            COALESCE(SUM(payment_failed_requests), 0) AS paymentFailedRequests,
            COALESCE(SUM(confirmed_bookings), 0) AS confirmedBookings,
            COALESCE(SUM(estimated_confirmed_revenue), 0) AS estimatedConfirmedRevenue,
            COALESCE(SUM(refunded_revenue), 0) AS refundedRevenue
          FROM ${totalsTable}
          WHERE ${whereTotalsSql}
        `),
          this.prisma.$queryRaw<PostingAnalyticsBucketRow[]>(Prisma.sql`
          SELECT
            bucket_start AS bucketStart,
            COALESCE(SUM(search_impressions), 0) AS searchImpressions,
            COALESCE(SUM(search_clicks), 0) AS searchClicks,
            COALESCE(SUM(views), 0) AS views,
            COALESCE(SUM(unique_views), 0) AS uniqueViews,
            COALESCE(SUM(booking_requests), 0) AS bookingRequests,
            COALESCE(SUM(approved_requests), 0) AS approvedRequests,
            COALESCE(SUM(declined_requests), 0) AS declinedRequests,
            COALESCE(SUM(expired_requests), 0) AS expiredRequests,
            COALESCE(SUM(cancelled_requests), 0) AS cancelledRequests,
            COALESCE(SUM(payment_failed_requests), 0) AS paymentFailedRequests,
            COALESCE(SUM(confirmed_bookings), 0) AS confirmedBookings,
            COALESCE(SUM(estimated_confirmed_revenue), 0) AS estimatedConfirmedRevenue,
            COALESCE(SUM(refunded_revenue), 0) AS refundedRevenue
          FROM ${detailTable}
          WHERE ${whereTotalsSql}
          GROUP BY bucket_start
          ORDER BY bucket_start ASC
        `),
          this.getOperationalMetricsMap(
            [this.toOperationalState(header)],
            range,
          ),
        ]);

        return [totals, buckets, operational] as const;
      },
    );

    const totals = this.combineMetrics(
      this.mapBucketMetrics(totalRows[0]),
      operationalMap.get(header.postingId) ??
        this.createEmptyOperationalMetrics(),
    );

    return {
      postingId: header.postingId,
      name: header.name,
      status: header.status,
      primaryPhotoUrl: header.primaryPhotoUrl ?? undefined,
      window: input.window,
      granularity: input.granularity,
      totals,
      derivedMetrics: this.createDerivedMetrics(totals),
      buckets: bucketRows.map((row): PostingAnalyticsBucket => {
        const startAt = row.bucketStart;
        const endAt = new Date(
          startAt.getTime() +
            (input.granularity === "hour"
              ? 60 * 60 * 1000
              : 24 * 60 * 60 * 1000),
        );
        const metrics = this.mapBucketMetrics(row);

        return {
          bucketStart: startAt.toISOString(),
          bucketEnd: endAt.toISOString(),
          granularity: input.granularity,
          metrics,
          derivedMetrics: this.createDerivedMetrics({
            ...metrics,
            activeDaysPublished: 0,
            confirmedBookedDays: 0,
          }),
        };
      }),
      dataAvailability: this.createDataAvailability(),
      range: this.mapRange(range.startAt, range.endAt),
    };
  }

  private async enqueueOutboxEvent(
    postingId: Uuid,
    organizationId: Uuid,
    eventType: PostingAnalyticsEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.postingAnalyticsOutbox.create({
        data: {
          id: newUuid(),
          postingId,
          organizationId,
          eventType,
          payload: payload as Prisma.InputJsonValue,
        },
      }),
    );
  }

  private async processSimpleCounterEvent(
    postingId: Uuid,
    organizationId: Uuid,
    eventDateIso: string,
    eventHourIso: string,
    increments: Partial<CounterIncrements>,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const eventDate = new Date(eventDateIso);
        const eventHour = new Date(eventHourIso);

        await this.incrementHourlyMetrics(
          transaction,
          postingId,
          organizationId,
          eventHour,
          increments,
        );
        await this.incrementDailyMetrics(
          transaction,
          postingId,
          organizationId,
          eventDate,
          increments,
        );
      }),
    );
  }

  private async findPostingAnalyticsHeader(
    postingId: Uuid,
    organizationId: Uuid,
  ): Promise<PostingAnalyticsHeaderRow | null> {
    const [row] = await this.executeAsync(() =>
      this.prisma.$queryRaw<PostingAnalyticsHeaderRow[]>(Prisma.sql`
        SELECT
          r.id AS postingId,
          r.name AS name,
          r.status AS status,
          (
            SELECT rp.blob_url
            FROM posting_photos rp
            WHERE rp.posting_id = r.id
            ORDER BY rp.position ASC
            LIMIT 1
          ) AS primaryPhotoUrl,
          r.published_at AS publishedAt,
          r.paused_at AS pausedAt,
          r.archived_at AS archivedAt
        FROM postings r
        WHERE r.id = ${postingId}
          AND r.organization_id = ${organizationId}
        LIMIT 1
      `),
    );

    return row ?? null;
  }

  private async listOperationalPostingStatesByOrganization(
    organizationId: Uuid,
  ): Promise<PostingOperationalStateRow[]> {
    return this.executeAsync(() =>
      this.prisma.$queryRaw<PostingOperationalStateRow[]>(Prisma.sql`
        SELECT
          id AS postingId,
          status,
          published_at AS publishedAt,
          paused_at AS pausedAt,
          archived_at AS archivedAt
        FROM postings
        WHERE organization_id = ${organizationId}
      `),
    );
  }

  private async getOperationalMetricsMap(
    postingStates: PostingOperationalStateRow[],
    range: { startAt?: Date; endAt: Date },
  ): Promise<Map<string, PostingOperationalMetrics>> {
    const postingIds = postingStates.map((posting) => posting.postingId);
    const metrics = new Map<string, PostingOperationalMetrics>(
      postingIds.map((postingId) => [
        postingId,
        this.createEmptyOperationalMetrics(),
      ]),
    );

    if (postingIds.length === 0) {
      return metrics;
    }

    const [ownerBlocks, rentings] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.$queryRaw<PostingTimeSpanRow[]>(
          this.createTimeSpanQuery(
            "posting_availability_blocks",
            "posting_id",
            postingIds,
            range,
            Prisma.sql`source = 'owner'`,
          ),
        ),
        this.prisma.$queryRaw<PostingTimeSpanRow[]>(
          this.createTimeSpanQuery("rentings", "posting_id", postingIds, range),
        ),
      ]),
    );

    for (const posting of postingStates) {
      const entry =
        metrics.get(posting.postingId) ?? this.createEmptyOperationalMetrics();
      entry.activeDaysPublished = this.calculateActiveDaysPublished(
        posting,
        range,
      );
      metrics.set(posting.postingId, entry);
    }

    for (const block of ownerBlocks) {
      const entry =
        metrics.get(block.postingId) ?? this.createEmptyOperationalMetrics();
      entry.calendarBlockedDays += this.calculateOverlapDays(
        block.startAt,
        block.endAt,
        range.startAt,
        range.endAt,
      );
      metrics.set(block.postingId, entry);
    }

    for (const renting of rentings) {
      const entry =
        metrics.get(renting.postingId) ?? this.createEmptyOperationalMetrics();
      entry.confirmedBookedDays += this.calculateOverlapDays(
        renting.startAt,
        renting.endAt,
        range.startAt,
        range.endAt,
      );
      metrics.set(renting.postingId, entry);
    }

    return metrics;
  }

  private createTimeSpanQuery(
    tableName: "posting_availability_blocks" | "rentings",
    postingIdColumn: "posting_id",
    postingIds: string[],
    range: { startAt?: Date; endAt: Date },
    extraWhere?: Prisma.Sql,
  ): Prisma.Sql {
    return Prisma.sql`
      SELECT
        ${Prisma.raw(postingIdColumn)} AS postingId,
        start_at AS startAt,
        end_at AS endAt
      FROM ${Prisma.raw(tableName)}
      WHERE ${Prisma.raw(postingIdColumn)} IN (${Prisma.join(postingIds)})
        AND start_at < ${range.endAt}
        ${range.startAt ? Prisma.sql`AND end_at > ${range.startAt}` : Prisma.empty}
        ${extraWhere ? Prisma.sql`AND ${extraWhere}` : Prisma.empty}
    `;
  }

  private async incrementHourlyMetrics(
    transaction: Prisma.TransactionClient,
    postingId: Uuid,
    organizationId: Uuid,
    bucketStart: Date,
    increments: Partial<CounterIncrements>,
  ): Promise<void> {
    await transaction.postingAnalyticsHourly.upsert({
      where: {
        postingId_bucketStart: {
          postingId,
          bucketStart,
        },
      },
      update: this.toCounterUpdate(increments),
      create: this.createRollupCreate(
        postingId,
        organizationId,
        bucketStart,
        increments,
      ),
    });
  }

  private async incrementDailyMetrics(
    transaction: Prisma.TransactionClient,
    postingId: Uuid,
    organizationId: Uuid,
    bucketStart: Date,
    increments: Partial<CounterIncrements>,
  ): Promise<void> {
    await transaction.postingAnalyticsDaily.upsert({
      where: {
        postingId_bucketStart: {
          postingId,
          bucketStart,
        },
      },
      update: this.toCounterUpdate(increments),
      create: this.createRollupCreate(
        postingId,
        organizationId,
        bucketStart,
        increments,
      ),
    });
  }

  private createRollupCreate(
    postingId: Uuid,
    organizationId: Uuid,
    bucketStart: Date,
    increments: Partial<CounterIncrements>,
  ) {
    return {
      id: newUuid(),
      postingId,
      organizationId,
      bucketStart,
      searchImpressions: increments.searchImpressions ?? 0,
      searchClicks: increments.searchClicks ?? 0,
      views: increments.views ?? 0,
      uniqueViews: increments.uniqueViews ?? 0,
      bookingRequests: increments.bookingRequests ?? 0,
      approvedRequests: increments.approvedRequests ?? 0,
      declinedRequests: increments.declinedRequests ?? 0,
      expiredRequests: increments.expiredRequests ?? 0,
      cancelledRequests: increments.cancelledRequests ?? 0,
      paymentFailedRequests: increments.paymentFailedRequests ?? 0,
      confirmedBookings: increments.confirmedBookings ?? 0,
      estimatedConfirmedRevenue:
        increments.estimatedConfirmedRevenue ?? new Prisma.Decimal(0),
      refundedRevenue: increments.refundedRevenue ?? new Prisma.Decimal(0),
    };
  }

  private toCounterUpdate(increments: Partial<CounterIncrements>) {
    return {
      ...(increments.searchImpressions
        ? {
            searchImpressions: {
              increment: increments.searchImpressions,
            },
          }
        : {}),
      ...(increments.searchClicks
        ? {
            searchClicks: {
              increment: increments.searchClicks,
            },
          }
        : {}),
      ...(increments.views
        ? {
            views: {
              increment: increments.views,
            },
          }
        : {}),
      ...(increments.uniqueViews
        ? {
            uniqueViews: {
              increment: increments.uniqueViews,
            },
          }
        : {}),
      ...(increments.bookingRequests
        ? {
            bookingRequests: {
              increment: increments.bookingRequests,
            },
          }
        : {}),
      ...(increments.approvedRequests
        ? {
            approvedRequests: {
              increment: increments.approvedRequests,
            },
          }
        : {}),
      ...(increments.declinedRequests
        ? {
            declinedRequests: {
              increment: increments.declinedRequests,
            },
          }
        : {}),
      ...(increments.expiredRequests
        ? {
            expiredRequests: {
              increment: increments.expiredRequests,
            },
          }
        : {}),
      ...(increments.cancelledRequests
        ? {
            cancelledRequests: {
              increment: increments.cancelledRequests,
            },
          }
        : {}),
      ...(increments.paymentFailedRequests
        ? {
            paymentFailedRequests: {
              increment: increments.paymentFailedRequests,
            },
          }
        : {}),
      ...(increments.confirmedBookings
        ? {
            confirmedBookings: {
              increment: increments.confirmedBookings,
            },
          }
        : {}),
      ...(increments.estimatedConfirmedRevenue
        ? {
            estimatedConfirmedRevenue: {
              increment: increments.estimatedConfirmedRevenue,
            },
          }
        : {}),
      ...(increments.refundedRevenue
        ? {
            refundedRevenue: {
              increment: increments.refundedRevenue,
            },
          }
        : {}),
    };
  }

  private dailyTableSql(): Prisma.Sql {
    return Prisma.sql`posting_analytics_daily`;
  }

  private hourlyTableSql(): Prisma.Sql {
    return Prisma.sql`posting_analytics_hourly`;
  }

  private createWindowRange(window: PostingAnalyticsWindow): {
    startAt?: Date;
    endAt: Date;
  } {
    const endAt = new Date();

    switch (window) {
      case "7d":
        return {
          startAt: new Date(endAt.getTime() - 7 * MILLIS_PER_DAY),
          endAt,
        };
      case "30d":
        return {
          startAt: new Date(endAt.getTime() - 30 * MILLIS_PER_DAY),
          endAt,
        };
      case "all":
      default:
        return {
          endAt,
        };
    }
  }

  private mapBucketMetrics(
    row?: AnalyticsAggregateRow,
  ): PostingAnalyticsBucketMetrics {
    return {
      searchImpressions: Number(row?.searchImpressions ?? 0),
      searchClicks: Number(row?.searchClicks ?? 0),
      views: Number(row?.views ?? 0),
      uniqueViews: Number(row?.uniqueViews ?? 0),
      bookingRequests: Number(row?.bookingRequests ?? 0),
      approvedRequests: Number(row?.approvedRequests ?? 0),
      declinedRequests: Number(row?.declinedRequests ?? 0),
      expiredRequests: Number(row?.expiredRequests ?? 0),
      cancelledRequests: Number(row?.cancelledRequests ?? 0),
      paymentFailedRequests: Number(row?.paymentFailedRequests ?? 0),
      confirmedBookings: Number(row?.confirmedBookings ?? 0),
      estimatedConfirmedRevenue: Number(row?.estimatedConfirmedRevenue ?? 0),
      refundedRevenue: Number(row?.refundedRevenue ?? 0),
    };
  }

  private combineMetrics(
    bucketMetrics: PostingAnalyticsBucketMetrics,
    operationalMetrics: PostingOperationalMetrics,
  ): PostingAnalyticsMetrics {
    return {
      ...bucketMetrics,
      activeDaysPublished: operationalMetrics.activeDaysPublished,
      calendarBlockedDays: operationalMetrics.calendarBlockedDays,
      confirmedBookedDays: operationalMetrics.confirmedBookedDays,
    };
  }

  private createDerivedMetrics(
    metrics: Pick<
      PostingAnalyticsMetrics,
      | "searchImpressions"
      | "searchClicks"
      | "views"
      | "bookingRequests"
      | "approvedRequests"
      | "confirmedBookings"
      | "estimatedConfirmedRevenue"
      | "activeDaysPublished"
      | "confirmedBookedDays"
    >,
  ): PostingAnalyticsDerivedMetrics {
    return {
      ctr: this.safeDivide(metrics.searchClicks, metrics.searchImpressions),
      viewToRequestRate: this.safeDivide(
        metrics.bookingRequests,
        metrics.views,
      ),
      clickToRequestRate: this.safeDivide(
        metrics.bookingRequests,
        metrics.searchClicks,
      ),
      requestToApprovalRate: this.safeDivide(
        metrics.approvedRequests,
        metrics.bookingRequests,
      ),
      requestToConfirmedRate: this.safeDivide(
        metrics.confirmedBookings,
        metrics.bookingRequests,
      ),
      utilizationRate: this.safeDivide(
        metrics.confirmedBookedDays,
        metrics.activeDaysPublished,
      ),
      averageRevenuePerConfirmedBooking: this.safeDivide(
        metrics.estimatedConfirmedRevenue,
        metrics.confirmedBookings,
      ),
    };
  }

  private createDataAvailability(): PostingAnalyticsDataAvailability {
    return {
      searchImpressions: "live",
      searchClicks: "live",
      views: "live",
      bookingRequests: "live",
      requestOutcomes: "live",
      confirmedBookings: "live",
      revenue: "live",
      isPartial: false,
    };
  }

  private mapRange(startAt: Date | undefined, endAt: Date) {
    return {
      startAt: startAt?.toISOString(),
      endAt: endAt.toISOString(),
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

  private mapOutbox(
    outbox: AnalyticsOutboxPersistence,
    processingAt?: Date,
  ): PostingAnalyticsOutboxRecord {
    return {
      id: asUuid(outbox.id),
      postingId: asUuid(outbox.postingId),
      organizationId: asUuid(outbox.organizationId),
      eventType: outbox.eventType as PostingAnalyticsEventType,
      payload: (outbox.payload ?? {}) as Record<string, unknown>,
      attempts: outbox.attempts,
      availableAt: outbox.availableAt.toISOString(),
      processingAt: (
        processingAt ??
        outbox.processingAt ??
        undefined
      )?.toISOString(),
      processedAt: outbox.processedAt?.toISOString(),
      lastError: outbox.lastError ?? undefined,
      createdAt: outbox.createdAt.toISOString(),
      updatedAt: outbox.updatedAt.toISOString(),
    };
  }

  private createEmptyOperationalMetrics(): PostingOperationalMetrics {
    return {
      activeDaysPublished: 0,
      calendarBlockedDays: 0,
      confirmedBookedDays: 0,
    };
  }

  private sumOperationalMetrics(
    metrics: Iterable<PostingOperationalMetrics>,
  ): PostingOperationalMetrics {
    const totals = this.createEmptyOperationalMetrics();

    for (const metric of metrics) {
      totals.activeDaysPublished += metric.activeDaysPublished;
      totals.calendarBlockedDays += metric.calendarBlockedDays;
      totals.confirmedBookedDays += metric.confirmedBookedDays;
    }

    return totals;
  }

  private toOperationalState(
    row: Pick<
      PostingAnalyticsHeaderRow | PostingAnalyticsListRow,
      "postingId" | "status" | "publishedAt" | "pausedAt" | "archivedAt"
    >,
  ): PostingOperationalStateRow {
    return {
      postingId: row.postingId,
      status: row.status,
      publishedAt: row.publishedAt,
      pausedAt: row.pausedAt,
      archivedAt: row.archivedAt,
    };
  }

  private calculateActiveDaysPublished(
    posting: PostingOperationalStateRow,
    range: { startAt?: Date; endAt: Date },
  ): number {
    if (!posting.publishedAt) {
      return 0;
    }

    const activeEnd =
      posting.archivedAt ??
      (posting.status === "paused" && posting.pausedAt
        ? posting.pausedAt
        : range.endAt);

    return this.calculateOverlapDays(
      posting.publishedAt,
      activeEnd,
      range.startAt,
      range.endAt,
    );
  }

  private calculateOverlapDays(
    startAt: Date,
    endAt: Date,
    rangeStartAt: Date | undefined,
    rangeEndAt: Date,
  ): number {
    const clampedStart = Math.max(
      startAt.getTime(),
      rangeStartAt?.getTime() ?? startAt.getTime(),
    );
    const clampedEnd = Math.min(endAt.getTime(), rangeEndAt.getTime());

    if (clampedEnd <= clampedStart) {
      return 0;
    }

    return Math.ceil((clampedEnd - clampedStart) / MILLIS_PER_DAY);
  }

  async listDailyAnalyticsForExport(
    organizationId: Uuid,
    window: PostingAnalyticsWindow,
  ): Promise<AnalyticsDailyExportRow[]> {
    const range = this.createWindowRange(window);
    const tableSql = this.dailyTableSql();

    return this.executeAsync(() =>
      this.prisma.$queryRaw<AnalyticsDailyExportRow[]>(Prisma.sql`
        SELECT
          ra.posting_id AS postingId,
          p.name AS postingName,
          ra.bucket_start AS date,
          COALESCE(ra.search_impressions, 0) AS searchImpressions,
          COALESCE(ra.search_clicks, 0) AS searchClicks,
          COALESCE(ra.views, 0) AS views,
          COALESCE(ra.unique_views, 0) AS uniqueViews,
          COALESCE(ra.booking_requests, 0) AS bookingRequests,
          COALESCE(ra.approved_requests, 0) AS approvedRequests,
          COALESCE(ra.declined_requests, 0) AS declinedRequests,
          COALESCE(ra.expired_requests, 0) AS expiredRequests,
          COALESCE(ra.cancelled_requests, 0) AS cancelledRequests,
          COALESCE(ra.payment_failed_requests, 0) AS paymentFailedRequests,
          COALESCE(ra.confirmed_bookings, 0) AS confirmedBookings,
          COALESCE(ra.estimated_confirmed_revenue, 0) AS estimatedConfirmedRevenue,
          COALESCE(ra.refunded_revenue, 0) AS refundedRevenue
        FROM ${tableSql} ra
        INNER JOIN postings p ON p.id = ra.posting_id
        WHERE p.organization_id = ${organizationId}
          ${range.startAt ? Prisma.sql`AND ra.bucket_start >= ${range.startAt}` : Prisma.empty}
          AND ra.bucket_start <= ${range.endAt}
        ORDER BY p.name ASC, ra.bucket_start ASC
      `),
    );
  }

  private safeDivide(numerator: number, denominator: number): number {
    if (
      !Number.isFinite(numerator) ||
      !Number.isFinite(denominator) ||
      denominator <= 0
    ) {
      return 0;
    }

    return numerator / denominator;
  }
}

interface CounterIncrements {
  searchImpressions: number;
  searchClicks: number;
  views: number;
  uniqueViews: number;
  bookingRequests: number;
  approvedRequests: number;
  declinedRequests: number;
  expiredRequests: number;
  cancelledRequests: number;
  paymentFailedRequests: number;
  confirmedBookings: number;
  estimatedConfirmedRevenue: Prisma.Decimal;
  refundedRevenue: Prisma.Decimal;
}

interface AnalyticsDailyExportRow {
  postingId: Uuid;
  postingName: string;
  date: Date;
  searchImpressions: bigint | number;
  searchClicks: bigint | number;
  views: bigint | number;
  uniqueViews: bigint | number;
  bookingRequests: bigint | number;
  approvedRequests: bigint | number;
  declinedRequests: bigint | number;
  expiredRequests: bigint | number;
  cancelledRequests: bigint | number;
  paymentFailedRequests: bigint | number;
  confirmedBookings: bigint | number;
  estimatedConfirmedRevenue: Prisma.Decimal | number | string;
  refundedRevenue: Prisma.Decimal | number | string;
}
