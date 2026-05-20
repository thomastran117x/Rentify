import { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";

function createAnalyticsOutboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    postingId: "posting-1",
    ownerId: "owner-1",
    eventType: "posting_viewed",
    payload: {
      occurredAt: "2026-05-20T12:00:00.000Z",
    },
    attempts: 0,
    availableAt: new Date("2026-05-20T12:00:00.000Z"),
    processingAt: null,
    processedAt: null,
    lastError: null,
    createdAt: new Date("2026-05-20T12:00:00.000Z"),
    updatedAt: new Date("2026-05-20T12:00:00.000Z"),
    ...overrides,
  };
}

describe("PostingsAnalyticsRepository", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("enqueues posting viewed events in the analytics outbox", async () => {
    const create = jest.fn(async () => undefined);
    const repository = new PostingsAnalyticsRepository({
      postingAnalyticsOutbox: {
        create,
      },
    } as never);

    await repository.enqueuePostingViewedEvent({
      postingId: "posting-1",
      ownerId: "owner-1",
      occurredAt: "2026-05-20T12:00:00.000Z",
      viewerHash: "viewer-hash",
      userId: "user-1",
      ipAddressHash: "ip-hash",
      userAgentHash: "ua-hash",
      deviceType: "desktop",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingId: "posting-1",
          ownerId: "owner-1",
          eventType: "posting_viewed",
          payload: {
            occurredAt: "2026-05-20T12:00:00.000Z",
            viewerHash: "viewer-hash",
            userId: "user-1",
            ipAddressHash: "ip-hash",
            userAgentHash: "ua-hash",
            deviceType: "desktop",
          },
        }),
      }),
    );
  });

  it("claims only outbox rows that win the update race", async () => {
    const findMany = jest.fn(async () => [
      createAnalyticsOutboxRow({
        id: "outbox-1",
      }),
      createAnalyticsOutboxRow({
        id: "outbox-2",
      }),
    ]);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({
        count: 1,
      })
      .mockResolvedValueOnce({
        count: 0,
      });
    const repository = new PostingsAnalyticsRepository({
      postingAnalyticsOutbox: {
        findMany,
        updateMany,
      },
    } as never);

    await expect(repository.claimOutboxBatch(10)).resolves.toEqual([
      {
        id: "outbox-1",
        postingId: "posting-1",
        ownerId: "owner-1",
        eventType: "posting_viewed",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        attempts: 0,
        availableAt: "2026-05-20T12:00:00.000Z",
        processingAt: "2026-05-20T12:00:00.000Z",
        processedAt: undefined,
        lastError: undefined,
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z",
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      }),
    );
  });

  it("schedules retries with exponential backoff and truncated errors", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new PostingsAnalyticsRepository({
      postingAnalyticsOutbox: {
        update,
      },
    } as never);

    await repository.markOutboxRetry("outbox-1", 3, "x".repeat(3000));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "outbox-1",
        },
        data: expect.objectContaining({
          attempts: {
            increment: 1,
          },
          processingAt: null,
          availableAt: new Date("2026-05-20T12:00:08.000Z"),
          lastError: "x".repeat(2048),
        }),
      }),
    );
  });

  it("processes posting viewed events into raw events and hourly and daily rollups", async () => {
    const transaction = {
      postingViewEvent: {
        create: jest.fn(async () => undefined),
      },
      postingAnalyticsUniqueView: {
        createMany: jest.fn(async () => ({
          count: 1,
        })),
      },
      postingAnalyticsHourly: {
        upsert: jest.fn(async () => undefined),
      },
      postingAnalyticsDaily: {
        upsert: jest.fn(async () => undefined),
      },
    };
    const repository = new PostingsAnalyticsRepository({
      $transaction: async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction),
    } as never);

    await repository.processPostingViewedEvent({
      postingId: "posting-1",
      ownerId: "owner-1",
      occurredAt: "2026-05-20T10:45:00.000Z",
      eventDate: "2026-05-20T00:00:00.000Z",
      eventHour: "2026-05-20T10:00:00.000Z",
      viewerHash: "viewer-hash",
      userId: "user-1",
      ipAddressHash: "ip-hash",
      userAgentHash: "ua-hash",
      deviceType: "desktop",
    });

    expect(transaction.postingViewEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingId: "posting-1",
          ownerId: "owner-1",
          viewerHash: "viewer-hash",
        }),
      }),
    );
    expect(transaction.postingAnalyticsUniqueView.createMany).toHaveBeenCalledWith({
      data: [
        {
          postingId: "posting-1",
          ownerId: "owner-1",
          viewerHash: "viewer-hash",
          eventDate: new Date("2026-05-20T00:00:00.000Z"),
        },
      ],
      skipDuplicates: true,
    });
    expect(transaction.postingAnalyticsHourly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          views: {
            increment: 1,
          },
          uniqueViews: {
            increment: 1,
          },
        }),
      }),
    );
    expect(transaction.postingAnalyticsDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          views: {
            increment: 1,
          },
          uniqueViews: {
            increment: 1,
          },
        }),
      }),
    );
  });

  it("computes owner summary totals, derived metrics, and operational day counts", async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          searchImpressions: 100,
          searchClicks: 25,
          views: 10,
          uniqueViews: 8,
          bookingRequests: 4,
          approvedRequests: 2,
          declinedRequests: 1,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings: 2,
          estimatedConfirmedRevenue: 400,
          refundedRevenue: 50,
        },
      ])
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          status: "published",
          publishedAt: new Date("2026-05-18T00:00:00.000Z"),
          pausedAt: null,
          archivedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          startAt: new Date("2026-05-19T00:00:00.000Z"),
          endAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          startAt: new Date("2026-05-18T12:00:00.000Z"),
          endAt: new Date("2026-05-19T12:00:00.000Z"),
        },
      ]);
    const repository = new PostingsAnalyticsRepository({
      $queryRaw: queryRaw,
    } as never);

    const result = await repository.getOwnerSummary({
      ownerId: "owner-1",
      window: "7d",
    });

    expect(result.window).toBe("7d");
    expect(result.totals).toMatchObject({
      searchImpressions: 100,
      searchClicks: 25,
      views: 10,
      bookingRequests: 4,
      confirmedBookings: 2,
      estimatedConfirmedRevenue: 400,
      refundedRevenue: 50,
      activeDaysPublished: 3,
      calendarBlockedDays: 1,
      confirmedBookedDays: 1,
    });
    expect(result.derivedMetrics).toMatchObject({
      ctr: 0.25,
      viewToRequestRate: 0.4,
      requestToConfirmedRate: 0.5,
      utilizationRate: 1 / 3,
      averageRevenuePerConfirmedBooking: 200,
    });
  });

  it("maps posting analytics list rows with operational metrics and pagination", async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          name: "Sunny loft",
          status: "published",
          primaryPhotoUrl: "https://example.test/photo.jpg",
          publishedAt: new Date("2026-05-18T00:00:00.000Z"),
          pausedAt: null,
          archivedAt: null,
          searchImpressions: 50,
          searchClicks: 10,
          views: 8,
          uniqueViews: 6,
          bookingRequests: 2,
          approvedRequests: 1,
          declinedRequests: 0,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings: 1,
          estimatedConfirmedRevenue: 220,
          refundedRevenue: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          total: 1,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          startAt: new Date("2026-05-19T00:00:00.000Z"),
          endAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ]);
    const repository = new PostingsAnalyticsRepository({
      $queryRaw: queryRaw,
    } as never);

    const result = await repository.listOwnerPostingsAnalytics({
      ownerId: "owner-1",
      window: "7d",
      page: 1,
      pageSize: 20,
    });

    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(result.postings[0]).toMatchObject({
      postingId: "posting-1",
      primaryPhotoUrl: "https://example.test/photo.jpg",
      totals: expect.objectContaining({
        confirmedBookedDays: 1,
      }),
    });
  });

  it("maps posting analytics detail totals, buckets, and operational metrics", async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          name: "Sunny loft",
          status: "published",
          primaryPhotoUrl: null,
          publishedAt: new Date("2026-05-18T00:00:00.000Z"),
          pausedAt: null,
          archivedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          searchImpressions: 20,
          searchClicks: 5,
          views: 4,
          uniqueViews: 3,
          bookingRequests: 2,
          approvedRequests: 1,
          declinedRequests: 0,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings: 1,
          estimatedConfirmedRevenue: 120,
          refundedRevenue: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          bucketStart: new Date("2026-05-20T08:00:00.000Z"),
          searchImpressions: 10,
          searchClicks: 2,
          views: 2,
          uniqueViews: 2,
          bookingRequests: 1,
          approvedRequests: 1,
          declinedRequests: 0,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings: 1,
          estimatedConfirmedRevenue: 120,
          refundedRevenue: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          postingId: "posting-1",
          startAt: new Date("2026-05-19T00:00:00.000Z"),
          endAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    const repository = new PostingsAnalyticsRepository({
      $queryRaw: queryRaw,
    } as never);

    const result = await repository.getPostingAnalyticsDetail({
      ownerId: "owner-1",
      postingId: "posting-1",
      window: "7d",
      granularity: "hour",
    });

    expect(result).toMatchObject({
      postingId: "posting-1",
      name: "Sunny loft",
      granularity: "hour",
      totals: expect.objectContaining({
        activeDaysPublished: 3,
        calendarBlockedDays: 1,
        confirmedBookedDays: 0,
      }),
    });
    expect(result?.buckets[0]).toEqual(
      expect.objectContaining({
        bucketStart: "2026-05-20T08:00:00.000Z",
        bucketEnd: "2026-05-20T09:00:00.000Z",
      }),
    );
  });
});
