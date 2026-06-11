import { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";

function createAnalyticsOutboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    postingId: "posting-1",
    organizationId: "org-1",
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
      organizationId: "org-1",
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
          organizationId: "org-1",
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

  it("enqueues the remaining analytics event types in the outbox", async () => {
    const create = jest.fn(async () => undefined);
    const repository = new PostingsAnalyticsRepository({
      postingAnalyticsOutbox: {
        create,
      },
    } as never) as unknown as Record<string, (input: unknown) => Promise<void>>;

    const cases = [
      {
        method: "enqueueSearchImpressionEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "search_impression",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueueSearchClickEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "search_click",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueueBookingRequestedEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
          estimatedTotal: 225,
        },
        eventType: "booking_requested",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
          estimatedTotal: 225,
        },
      },
      {
        method: "enqueueBookingApprovedEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "booking_approved",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueueBookingDeclinedEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "booking_declined",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueueBookingExpiredEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "booking_expired",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueueBookingCancelledEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "booking_cancelled",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueuePaymentFailedEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
        eventType: "payment_failed",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
        },
      },
      {
        method: "enqueueRefundRecordedEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
          refundedAmount: 40,
        },
        eventType: "refund_recorded",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
          refundedAmount: 40,
        },
      },
      {
        method: "enqueueRentingConfirmedEvent",
        input: {
          postingId: "posting-1",
          organizationId: "org-1",
          occurredAt: "2026-05-20T12:00:00.000Z",
          estimatedTotal: 180,
        },
        eventType: "renting_confirmed",
        payload: {
          occurredAt: "2026-05-20T12:00:00.000Z",
          estimatedTotal: 180,
        },
      },
    ] as const;

    for (const testCase of cases) {
      await repository[testCase.method](testCase.input);
    }

    expect(create).toHaveBeenCalledTimes(cases.length);
    cases.forEach((testCase, index) => {
      expect(create).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({
          data: expect.objectContaining({
            postingId: "posting-1",
            organizationId: "org-1",
            eventType: testCase.eventType,
            payload: testCase.payload,
          }),
        }),
      );
    });
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
        organizationId: "org-1",
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

  it("marks outbox rows as processed and clears retry state", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new PostingsAnalyticsRepository({
      postingAnalyticsOutbox: {
        update,
      },
    } as never);

    await repository.markOutboxProcessed("outbox-1");

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "outbox-1",
      },
      data: expect.objectContaining({
        processingAt: null,
        lastError: null,
      }),
    });
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
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    } as never);

    await repository.processPostingViewedEvent({
      postingId: "posting-1",
      organizationId: "org-1",
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
          organizationId: "org-1",
          viewerHash: "viewer-hash",
        }),
      }),
    );
    expect(
      transaction.postingAnalyticsUniqueView.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          postingId: "posting-1",
          organizationId: "org-1",
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

  it("does not increment unique views when a posting view hashes to an existing daily viewer", async () => {
    const transaction = {
      postingViewEvent: {
        create: jest.fn(async () => undefined),
      },
      postingAnalyticsUniqueView: {
        createMany: jest.fn(async () => ({
          count: 0,
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
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    } as never);

    await repository.processPostingViewedEvent({
      postingId: "posting-1",
      organizationId: "org-1",
      occurredAt: "2026-05-20T10:45:00.000Z",
      eventDate: "2026-05-20T00:00:00.000Z",
      eventHour: "2026-05-20T10:00:00.000Z",
      viewerHash: "viewer-hash",
      userId: "user-1",
      ipAddressHash: "ip-hash",
      userAgentHash: "ua-hash",
      deviceType: "desktop",
    });

    expect(transaction.postingAnalyticsHourly.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          views: {
            increment: 1,
          },
        },
        create: expect.objectContaining({
          uniqueViews: 0,
        }),
      }),
    );
  });

  it("processes simple counter analytics events into hourly and daily rollups", async () => {
    const cases = [
      {
        method: "processSearchImpressionEvent",
        expectedKey: "searchImpressions",
      },
      {
        method: "processSearchClickEvent",
        expectedKey: "searchClicks",
      },
      {
        method: "processBookingRequestedEvent",
        expectedKey: "bookingRequests",
      },
      {
        method: "processBookingApprovedEvent",
        expectedKey: "approvedRequests",
      },
      {
        method: "processBookingDeclinedEvent",
        expectedKey: "declinedRequests",
      },
      {
        method: "processBookingExpiredEvent",
        expectedKey: "expiredRequests",
      },
      {
        method: "processBookingCancelledEvent",
        expectedKey: "cancelledRequests",
      },
      {
        method: "processPaymentFailedEvent",
        expectedKey: "paymentFailedRequests",
      },
    ] as const;

    for (const testCase of cases) {
      const transaction = {
        postingAnalyticsHourly: {
          upsert: jest.fn(async () => undefined),
        },
        postingAnalyticsDaily: {
          upsert: jest.fn(async () => undefined),
        },
      };
      const repository = new PostingsAnalyticsRepository({
        $transaction: async (
          callback: (tx: typeof transaction) => Promise<void>,
        ) => callback(transaction),
      } as never) as unknown as Record<
        string,
        (input: unknown) => Promise<void>
      >;

      await repository[testCase.method]({
        postingId: "posting-1",
        organizationId: "org-1",
        occurredAt: "2026-05-20T10:45:00.000Z",
        eventDate: "2026-05-20T00:00:00.000Z",
        eventHour: "2026-05-20T10:00:00.000Z",
      });

      expect(transaction.postingAnalyticsHourly.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            [testCase.expectedKey]: {
              increment: 1,
            },
          }),
        }),
      );
      expect(transaction.postingAnalyticsDaily.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            [testCase.expectedKey]: 1,
          }),
        }),
      );
    }
  });

  it("processes refund and confirmed renting events into revenue rollups", async () => {
    const refundTransaction = {
      postingAnalyticsHourly: {
        upsert: jest.fn(async () => undefined),
      },
      postingAnalyticsDaily: {
        upsert: jest.fn(async () => undefined),
      },
    };
    const refundRepository = new PostingsAnalyticsRepository({
      $transaction: async (
        callback: (tx: typeof refundTransaction) => Promise<void>,
      ) => callback(refundTransaction),
    } as never);

    await refundRepository.processRefundRecordedEvent({
      postingId: "posting-1",
      organizationId: "org-1",
      occurredAt: "2026-05-20T10:45:00.000Z",
      eventDate: "2026-05-20T00:00:00.000Z",
      eventHour: "2026-05-20T10:00:00.000Z",
      refundedAmount: 55.5,
    });

    const refundHourlyCall =
      refundTransaction.postingAnalyticsHourly.upsert.mock.calls[0]?.[0];
    expect(
      refundHourlyCall?.update?.refundedRevenue?.increment?.toString(),
    ).toBe("55.5");

    const rentingTransaction = {
      postingAnalyticsHourly: {
        upsert: jest.fn(async () => undefined),
      },
      postingAnalyticsDaily: {
        upsert: jest.fn(async () => undefined),
      },
    };
    const rentingRepository = new PostingsAnalyticsRepository({
      $transaction: async (
        callback: (tx: typeof rentingTransaction) => Promise<void>,
      ) => callback(rentingTransaction),
    } as never);

    await rentingRepository.processRentingConfirmedEvent({
      postingId: "posting-1",
      organizationId: "org-1",
      occurredAt: "2026-05-20T10:45:00.000Z",
      eventDate: "2026-05-20T00:00:00.000Z",
      eventHour: "2026-05-20T10:00:00.000Z",
      estimatedTotal: 275,
    });

    const rentingDailyCall =
      rentingTransaction.postingAnalyticsDaily.upsert.mock.calls[0]?.[0];
    expect(rentingDailyCall?.create?.confirmedBookings).toBe(1);
    expect(
      rentingDailyCall?.update?.estimatedConfirmedRevenue?.increment?.toString(),
    ).toBe("275");
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
      actorUserId: "owner-1",
      organizationId: "org-1",
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
      actorUserId: "owner-1",
      organizationId: "org-1",
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
      actorUserId: "owner-1",
      organizationId: "org-1",
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

  it("returns null when posting analytics detail cannot find a visible header", async () => {
    const queryRaw = jest.fn(async () => []);
    const repository = new PostingsAnalyticsRepository({
      $queryRaw: queryRaw,
    } as never);

    await expect(
      repository.getPostingAnalyticsDetail({
        actorUserId: "owner-1",
        organizationId: "org-1",
        postingId: "missing-posting",
        window: "7d",
        granularity: "day",
      }),
    ).resolves.toBeNull();
  });

  it("covers analytics repository helper branches for ranges, metrics, and pagination", async () => {
    const repository = new PostingsAnalyticsRepository(
      {} as never,
    ) as unknown as {
      createWindowRange: (window: "7d" | "30d" | "all") => {
        startAt?: Date;
        endAt: Date;
      };
      mapBucketMetrics: (
        row?: Record<string, unknown>,
      ) => Record<string, number>;
      combineMetrics: (
        bucketMetrics: Record<string, number>,
        operationalMetrics: Record<string, number>,
      ) => Record<string, number>;
      createDerivedMetrics: (
        metrics: Record<string, number>,
      ) => Record<string, number>;
      createPagination: (
        page: number,
        pageSize: number,
        total: number,
      ) => Record<string, number | boolean>;
      mapOutbox: (
        outbox: ReturnType<typeof createAnalyticsOutboxRow>,
        processingAt?: Date,
      ) => Record<string, unknown>;
      createEmptyOperationalMetrics: () => Record<string, number>;
      sumOperationalMetrics: (
        metrics: Array<Record<string, number>>,
      ) => Record<string, number>;
      toOperationalState: (
        row: Record<string, unknown>,
      ) => Record<string, unknown>;
      calculateActiveDaysPublished: (
        posting: Record<string, unknown>,
        range: { startAt?: Date; endAt: Date },
      ) => number;
      calculateOverlapDays: (
        startAt: Date,
        endAt: Date,
        rangeStartAt: Date | undefined,
        rangeEndAt: Date,
      ) => number;
      safeDivide: (numerator: number, denominator: number) => number;
    };

    const thirtyDayRange = repository.createWindowRange("30d");
    expect(thirtyDayRange.startAt).toBeInstanceOf(Date);
    expect(repository.createWindowRange("all").startAt).toBeUndefined();

    expect(repository.mapBucketMetrics()).toEqual({
      searchImpressions: 0,
      searchClicks: 0,
      views: 0,
      uniqueViews: 0,
      bookingRequests: 0,
      approvedRequests: 0,
      declinedRequests: 0,
      expiredRequests: 0,
      cancelledRequests: 0,
      paymentFailedRequests: 0,
      confirmedBookings: 0,
      estimatedConfirmedRevenue: 0,
      refundedRevenue: 0,
    });
    expect(
      repository.combineMetrics(
        repository.mapBucketMetrics({
          searchImpressions: 10,
          searchClicks: 2,
          views: 5,
          uniqueViews: 4,
          bookingRequests: 1,
          approvedRequests: 1,
          declinedRequests: 0,
          expiredRequests: 0,
          cancelledRequests: 0,
          paymentFailedRequests: 0,
          confirmedBookings: 1,
          estimatedConfirmedRevenue: 120,
          refundedRevenue: 10,
        }),
        {
          activeDaysPublished: 3,
          calendarBlockedDays: 1,
          confirmedBookedDays: 1,
        },
      ),
    ).toMatchObject({
      searchImpressions: 10,
      activeDaysPublished: 3,
      confirmedBookedDays: 1,
    });
    expect(
      repository.createDerivedMetrics({
        searchImpressions: 0,
        searchClicks: 0,
        views: 0,
        bookingRequests: 0,
        approvedRequests: 0,
        confirmedBookings: 0,
        estimatedConfirmedRevenue: 0,
        activeDaysPublished: 0,
        confirmedBookedDays: 0,
      }),
    ).toEqual({
      ctr: 0,
      viewToRequestRate: 0,
      clickToRequestRate: 0,
      requestToApprovalRate: 0,
      requestToConfirmedRate: 0,
      utilizationRate: 0,
      averageRevenuePerConfirmedBooking: 0,
    });
    expect(repository.createPagination(2, 10, 25)).toEqual({
      page: 2,
      pageSize: 10,
      total: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });

    expect(
      repository.mapOutbox(
        createAnalyticsOutboxRow({
          processingAt: new Date("2026-05-20T12:10:00.000Z"),
          processedAt: new Date("2026-05-20T12:15:00.000Z"),
        }),
      ),
    ).toMatchObject({
      processingAt: "2026-05-20T12:10:00.000Z",
      processedAt: "2026-05-20T12:15:00.000Z",
    });
    expect(repository.createEmptyOperationalMetrics()).toEqual({
      activeDaysPublished: 0,
      calendarBlockedDays: 0,
      confirmedBookedDays: 0,
    });
    expect(
      repository.sumOperationalMetrics([
        {
          activeDaysPublished: 2,
          calendarBlockedDays: 1,
          confirmedBookedDays: 0,
        },
        {
          activeDaysPublished: 1,
          calendarBlockedDays: 0,
          confirmedBookedDays: 2,
        },
      ]),
    ).toEqual({
      activeDaysPublished: 3,
      calendarBlockedDays: 1,
      confirmedBookedDays: 2,
    });
    expect(
      repository.toOperationalState({
        postingId: "posting-1",
        status: "paused",
        publishedAt: new Date("2026-05-18T00:00:00.000Z"),
        pausedAt: new Date("2026-05-20T00:00:00.000Z"),
        archivedAt: null,
      }),
    ).toEqual({
      postingId: "posting-1",
      status: "paused",
      publishedAt: new Date("2026-05-18T00:00:00.000Z"),
      pausedAt: new Date("2026-05-20T00:00:00.000Z"),
      archivedAt: null,
    });
    expect(
      repository.calculateActiveDaysPublished(
        {
          postingId: "posting-1",
          status: "paused",
          publishedAt: new Date("2026-05-18T00:00:00.000Z"),
          pausedAt: new Date("2026-05-20T00:00:00.000Z"),
          archivedAt: null,
        },
        {
          startAt: new Date("2026-05-17T00:00:00.000Z"),
          endAt: new Date("2026-05-21T00:00:00.000Z"),
        },
      ),
    ).toBe(2);
    expect(
      repository.calculateActiveDaysPublished(
        {
          postingId: "posting-2",
          status: "draft",
          publishedAt: null,
          pausedAt: null,
          archivedAt: null,
        },
        {
          endAt: new Date("2026-05-21T00:00:00.000Z"),
        },
      ),
    ).toBe(0);
    expect(
      repository.calculateOverlapDays(
        new Date("2026-05-10T00:00:00.000Z"),
        new Date("2026-05-11T00:00:00.000Z"),
        new Date("2026-05-12T00:00:00.000Z"),
        new Date("2026-05-13T00:00:00.000Z"),
      ),
    ).toBe(0);
    expect(repository.safeDivide(4, 2)).toBe(2);
    expect(repository.safeDivide(4, 0)).toBe(0);
    expect(repository.safeDivide(Number.NaN, 2)).toBe(0);
  });
});
