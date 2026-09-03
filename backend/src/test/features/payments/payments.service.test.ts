import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { CacheService } from "@/features/cache/cache.service";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import { PaymentsService } from "@/features/payments/payments.service";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { testUuid } from "../../support/uuid";
const ATTEMPT_1_ID = testUuid(9200, 451335);
const IGNORED_BY_SERVICE_ID = testUuid(9200, 16965);
const ORG_1_ID = testUuid(9200, 9234);
const OWNER_1_ID = testUuid(9200, 219201);
const PAYMENT_2_ID = testUuid(9200, 132103);
const PAYOUT_1_ID = testUuid(9200, 783166);
const PAYOUT_2_ID = testUuid(9200, 783167);
const POSTING_1_ID = testUuid(9200, 254272);
const POSTING_2_ID = testUuid(9200, 254273);
const REFUND_1_ID = testUuid(9200, 376102);
const SQUARE_PAY_1_ID = testUuid(9200, 565949);
const STRANGER_1_ID = testUuid(9000, 244047);

const BOOKING_1_ID = testUuid(9000, 996753);
const BOOKING_MISSING_ID = testUuid(9000, 351960);
const MANAGER_1_ID = testUuid(9000, 836503);
const PAYMENT_1_ID = testUuid(9000, 132102);
const RENTER_1_ID = testUuid(9000, 235000);

function createPaymentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_1_ID,
    bookingRequestId: BOOKING_1_ID,
    postingId: POSTING_1_ID,
    renterId: RENTER_1_ID,
    ownerId: OWNER_1_ID,
    organizationId: ORG_1_ID,
    provider: "square" as const,
    status: "succeeded" as const,
    pricingCurrency: "CAD",
    rentalSubtotalAmount: 100,
    platformFeeAmount: 10,
    totalAmount: 110,
    squarePaymentId: SQUARE_PAY_1_ID,
    squareOrderId: "square-order-1",
    failedAt: "2026-04-20T00:10:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    booking: {
      id: BOOKING_1_ID,
      status: "awaiting_payment",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
      paymentReconciliationRequired: true,
    },
    attempts: [],
    refunds: [],
    ...overrides,
  };
}

function createService(overrides?: {
  repository?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  analytics?: Record<string, unknown>;
  postings?: Record<string, unknown>;
  cache?: Record<string, unknown>;
  publicCache?: Record<string, unknown>;
  orgAccess?: Record<string, unknown>;
}) {
  const paymentsRepository = {
    createPaymentAttemptForBooking: jest.fn(async () => ({
      paymentId: PAYMENT_1_ID,
      attemptId: ATTEMPT_1_ID,
      amount: 110,
      currency: "CAD",
      payment: createPaymentRecord({
        status: "awaiting_method",
        attempts: [],
      }),
    })),
    attachPaymentSession: jest.fn(async () =>
      createPaymentRecord({
        status: "processing",
      }),
    ),
    recordAttemptFailure: jest.fn(async () =>
      createPaymentRecord({
        status: "failed_retryable",
      }),
    ),
    findById: jest.fn(async () => createPaymentRecord()),
    findBySquareReferences: jest.fn(async () => createPaymentRecord()),
    createRefundRecord: jest.fn(async () => ({
      refundId: REFUND_1_ID,
      paymentId: PAYMENT_1_ID,
      providerPaymentId: SQUARE_PAY_1_ID,
      pricingCurrency: "CAD",
    })),
    completeRefund: jest.fn(async () =>
      createPaymentRecord({
        status: "refunded",
      }),
    ),
    listPayoutsForOrganization: jest.fn(async () => ({
      payouts: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    upsertWebhookEvent: jest.fn(async () => ({
      alreadyProcessed: false,
    })),
    markWebhookProcessed: jest.fn(async () => undefined),
    markPaymentSucceeded: jest.fn(async () => ({
      payment: createPaymentRecord(),
      reconciliationRequired: false,
    })),
    markPaymentFailed: jest.fn(async () =>
      createPaymentRecord({
        status: "failed_final",
      }),
    ),
    listRetryCandidates: jest.fn(async () => []),
    markAttemptForRetry: jest.fn(async () => null),
    listRepairCandidates: jest.fn(async () => []),
    listDuePayouts: jest.fn(async () => []),
    markPayoutReleased: jest.fn(async () => undefined),
    markPayoutFailed: jest.fn(async () => undefined),
    ...overrides?.repository,
  } as unknown as PaymentsRepository;

  const paymentProvider = {
    createPaymentSession: jest.fn(async () => ({
      providerRequestId: "provider-request-1",
      providerPaymentId: SQUARE_PAY_1_ID,
      providerOrderId: "square-order-1",
      checkoutUrl: "https://square.test/checkout",
      locationId: "location-1",
      raw: {
        ok: true,
      },
    })),
    classifyError: jest.fn(() => ({
      category: "transient",
      message: "provider unavailable",
      retryable: true,
      code: "TEMP_DOWN",
    })),
    createRefund: jest.fn(async () => ({
      providerRefundId: "square-refund-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    })),
    verifyWebhookSignature: jest.fn(() => ({
      payload: {
        data: {
          object: {
            payment: {
              id: SQUARE_PAY_1_ID,
              order_id: "square-order-1",
              status: "COMPLETED",
            },
          },
        },
      },
      eventId: "event-1",
      eventType: "payment.updated",
      isValid: true,
    })),
    getPaymentStatus: jest.fn(async () => ({
      providerPaymentId: SQUARE_PAY_1_ID,
      providerOrderId: "square-order-1",
      status: "COMPLETED",
      raw: {},
    })),
    ...overrides?.provider,
  } as unknown as PaymentProviderAdapter;

  const analyticsRepository = {
    enqueuePaymentFailedEvent: jest.fn(async () => undefined),
    enqueueRefundRecordedEvent: jest.fn(async () => undefined),
    ...overrides?.analytics,
  } as unknown as PostingsAnalyticsRepository;

  const postingsRepository = {
    enqueueSearchSync: jest.fn(async () => undefined),
    ...overrides?.postings,
  } as unknown as PostingsRepository;

  const cacheService = {
    acquireLock: jest.fn(async (key: string) => ({
      key,
      token: `${key}-token`,
      release: jest.fn(async () => true),
      extend: jest.fn(async () => true),
    })),
    ...overrides?.cache,
  } as unknown as CacheService;

  const postingsPublicCacheService = {
    invalidatePublic: jest.fn(async () => 1),
    ...overrides?.publicCache,
  } as unknown as PostingsPublicCacheService;

  const organizationAccessService = {
    requireActiveMembership: jest.fn(async () => ({
      organizationId: ORG_1_ID,
      userId: MANAGER_1_ID,
      role: "manager",
    })),
    requireMembership: jest.fn(async () => ({
      organizationId: ORG_1_ID,
      userId: OWNER_1_ID,
      role: "manager",
    })),
    findMembership: jest.fn(async () => null),
    assertCanManage: jest.fn(),
    ...overrides?.orgAccess,
  } as unknown as OrganizationAccessService;

  return {
    service: new PaymentsService(
      paymentsRepository,
      paymentProvider,
      analyticsRepository,
      postingsRepository,
      cacheService,
      postingsPublicCacheService,
      organizationAccessService,
    ),
    paymentsRepository,
    paymentProvider,
    analyticsRepository,
    postingsRepository,
    cacheService,
    postingsPublicCacheService,
    organizationAccessService,
  };
}

describe("PaymentsService", () => {
  it("reuses an existing provider session instead of creating a new one", async () => {
    const { service, paymentsRepository, paymentProvider } = createService({
      repository: {
        createPaymentAttemptForBooking: jest.fn(async () => ({
          paymentId: PAYMENT_1_ID,
          attemptId: ATTEMPT_1_ID,
          amount: 110,
          currency: "CAD",
          payment: createPaymentRecord({
            status: "processing",
            attempts: [
              {
                id: ATTEMPT_1_ID,
                providerRequestId: "provider-request-1",
              },
            ],
          }),
        })),
      },
    });

    const result = await service.createPaymentSession({
      bookingRequestId: BOOKING_1_ID,
      renterId: RENTER_1_ID,
      idempotencyKey: "idem-1",
    });

    expect(
      paymentProvider.createPaymentSession as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(
      paymentsRepository.attachPaymentSession as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(result.status).toBe("processing");
  });

  it("creates and attaches a provider payment session", async () => {
    const {
      service,
      paymentsRepository,
      paymentProvider,
      postingsRepository,
      postingsPublicCacheService,
    } = createService();

    const result = await service.createPaymentSession({
      bookingRequestId: BOOKING_1_ID,
      renterId: RENTER_1_ID,
      idempotencyKey: "idem-1",
    });

    expect(
      paymentProvider.createPaymentSession as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRequestId: BOOKING_1_ID,
        paymentId: PAYMENT_1_ID,
        amount: 110,
        currency: "CAD",
      }),
    );
    expect(
      paymentsRepository.attachPaymentSession as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      PAYMENT_1_ID,
      ATTEMPT_1_ID,
      expect.objectContaining({
        providerPaymentId: SQUARE_PAY_1_ID,
      }),
    );
    expect(
      postingsPublicCacheService.invalidatePublic as unknown as jest.Mock,
    ).toHaveBeenCalledWith(POSTING_1_ID);
    expect(
      postingsRepository.enqueueSearchSync as unknown as jest.Mock,
    ).toHaveBeenCalledWith(POSTING_1_ID);
    expect(result.status).toBe("processing");
  });

  it("records provider session failures and emits failed-payment analytics", async () => {
    const {
      service,
      paymentsRepository,
      paymentProvider,
      analyticsRepository,
    } = createService({
      provider: {
        createPaymentSession: jest.fn(async () => {
          throw new Error("square unavailable");
        }),
      },
      repository: {
        recordAttemptFailure: jest.fn(async () =>
          createPaymentRecord({
            status: "failed_retryable",
            failedAt: "2026-04-20T00:20:00.000Z",
          }),
        ),
      },
    });

    const result = await service.createPaymentSession({
      bookingRequestId: BOOKING_1_ID,
      renterId: RENTER_1_ID,
      idempotencyKey: "idem-1",
    });

    expect(
      paymentProvider.classifyError as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(
      paymentsRepository.recordAttemptFailure as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      PAYMENT_1_ID,
      ATTEMPT_1_ID,
      expect.objectContaining({
        message: "provider unavailable",
      }),
    );
    expect(
      analyticsRepository.enqueuePaymentFailedEvent as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      postingId: POSTING_1_ID,
      organizationId: ORG_1_ID,
      occurredAt: "2026-04-20T00:20:00.000Z",
    });
    expect(result.status).toBe("failed_retryable");
  });

  it("rejects retry requests when the payment status is not retryable", async () => {
    const { service } = createService({
      repository: {
        findById: jest.fn(async () =>
          createPaymentRecord({
            status: "processing",
            renterId: RENTER_1_ID,
          }),
        ),
      },
    });

    await expect(
      service.retryPayment({
        paymentId: PAYMENT_1_ID,
        renterId: RENTER_1_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("creates refunds and records refund analytics", async () => {
    const {
      service,
      paymentsRepository,
      paymentProvider,
      analyticsRepository,
    } = createService({
      repository: {
        completeRefund: jest.fn(async () =>
          createPaymentRecord({
            status: "refunded",
          }),
        ),
      },
    });

    const result = await service.createRefund({
      paymentId: PAYMENT_1_ID,
      actorUserId: RENTER_1_ID,
      amount: 42,
      reason: "Customer requested refund",
      idempotencyKey: "refund-idem-1",
    });

    expect(
      paymentsRepository.createRefundRecord as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_1_ID,
        actorUserId: RENTER_1_ID,
        amount: 42,
      }),
    );
    expect(
      paymentProvider.createRefund as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: SQUARE_PAY_1_ID,
        amount: 42,
        currency: "CAD",
      }),
    );
    expect(
      analyticsRepository.enqueueRefundRecordedEvent as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      postingId: POSTING_1_ID,
      organizationId: ORG_1_ID,
      occurredAt: expect.any(String),
      refundedAmount: 42,
    });
    expect(result.status).toBe("refunded");
  });

  it("lists payouts through the active managed membership", async () => {
    const { service, paymentsRepository, organizationAccessService } =
      createService();

    await service.listPayouts({
      actorUserId: MANAGER_1_ID,
      organizationId: IGNORED_BY_SERVICE_ID,
      page: 2,
      pageSize: 5,
      status: "scheduled",
    });

    expect(
      organizationAccessService.requireActiveMembership as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      MANAGER_1_ID,
      "Select or join an organization before viewing payouts.",
    );
    expect(
      organizationAccessService.assertCanManage as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(
      paymentsRepository.listPayoutsForOrganization as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      actorUserId: MANAGER_1_ID,
      organizationId: ORG_1_ID,
      page: 2,
      pageSize: 5,
      status: "scheduled",
    });
  });

  it("rejects invalid webhook signatures after persisting the event", async () => {
    const { service, paymentsRepository } = createService({
      provider: {
        verifyWebhookSignature: jest.fn(() => ({
          payload: {
            data: {
              object: {
                payment: {
                  id: SQUARE_PAY_1_ID,
                  order_id: "square-order-1",
                  status: "COMPLETED",
                },
              },
            },
          },
          eventId: "event-1",
          eventType: "payment.updated",
          isValid: false,
        })),
      },
    });

    await expect(
      service.processSquareWebhook("{}", "bad-sig"),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(
      paymentsRepository.upsertWebhookEvent as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  it("returns early when the webhook was already processed", async () => {
    const { service, paymentsRepository } = createService({
      repository: {
        upsertWebhookEvent: jest.fn(async () => ({
          alreadyProcessed: true,
        })),
      },
    });

    await service.processSquareWebhook("{}", "sig");

    expect(
      paymentsRepository.markPaymentSucceeded as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  it("records failed webhook payment statuses and analytics", async () => {
    const { service, paymentsRepository, analyticsRepository } = createService({
      provider: {
        verifyWebhookSignature: jest.fn(() => ({
          payload: {
            data: {
              object: {
                payment: {
                  id: SQUARE_PAY_1_ID,
                  order_id: "square-order-1",
                  status: "FAILED",
                },
              },
            },
          },
          eventId: "event-2",
          eventType: "payment.updated",
          isValid: true,
        })),
      },
      repository: {
        markPaymentFailed: jest.fn(async () =>
          createPaymentRecord({
            status: "failed_final",
            failedAt: "2026-04-20T00:20:00.000Z",
          }),
        ),
      },
    });

    await service.processSquareWebhook("{}", "sig");

    expect(
      paymentsRepository.markPaymentFailed as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "payment.updated",
      }),
      "permanent",
    );
    expect(
      analyticsRepository.enqueuePaymentFailedEvent as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).toHaveBeenCalledWith("event-2");
  });

  it("throws ConflictError on reconcile when payment success needs reconciliation", async () => {
    const payment = createPaymentRecord();
    const { service, cacheService, postingsPublicCacheService } = createService(
      {
        repository: {
          findById: jest.fn(async () => payment),
          markPaymentSucceeded: jest.fn(async () => ({
            payment,
            reconciliationRequired: true,
          })),
        },
      },
    );

    await expect(
      service.reconcilePayment(PAYMENT_1_ID, RENTER_1_ID),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      (cacheService.acquireLock as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toBe(`posting:${POSTING_1_ID}:booking-window`);
    expect(
      postingsPublicCacheService.invalidatePublic as unknown as jest.Mock,
    ).toHaveBeenCalledWith(POSTING_1_ID);
  });

  it("throws when reconciliation cannot find the provider payment", async () => {
    const { service } = createService({
      provider: {
        getPaymentStatus: jest.fn(async () => null),
      },
    });

    await expect(
      service.reconcilePayment(PAYMENT_1_ID, RENTER_1_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("does not throw from webhook processing when payment success needs reconciliation", async () => {
    const payment = createPaymentRecord();
    const { service, paymentsRepository, postingsPublicCacheService } =
      createService({
        repository: {
          markPaymentSucceeded: jest.fn(async () => ({
            payment,
            reconciliationRequired: true,
          })),
        },
      });

    await expect(
      service.processSquareWebhook("{}", "sig"),
    ).resolves.toBeUndefined();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).toHaveBeenCalledWith("event-1");
    expect(
      postingsPublicCacheService.invalidatePublic as unknown as jest.Mock,
    ).toHaveBeenCalledWith(POSTING_1_ID);
  });

  it("replays retry candidates through provider session creation", async () => {
    const { service, paymentsRepository } = createService({
      repository: {
        listRetryCandidates: jest.fn(async () => [
          {
            attemptId: ATTEMPT_1_ID,
            paymentId: PAYMENT_1_ID,
            idempotencyKey: "idem-1",
            retryCount: 1,
          },
        ]),
        markAttemptForRetry: jest.fn(async () => ({
          paymentId: PAYMENT_1_ID,
          bookingRequestId: BOOKING_1_ID,
          idempotencyKey: "idem-1",
          amount: 110,
          currency: "CAD",
        })),
      },
    });

    const processed = await service.processRetryQueue(5);

    expect(processed).toBe(1);
    expect(
      paymentsRepository.attachPaymentSession as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      PAYMENT_1_ID,
      ATTEMPT_1_ID,
      expect.objectContaining({
        providerPaymentId: SQUARE_PAY_1_ID,
      }),
    );
  });

  it("repairs each queued payment candidate", async () => {
    const { service, paymentsRepository } = createService({
      repository: {
        listRepairCandidates: jest.fn(async () => [
          {
            paymentId: PAYMENT_1_ID,
          },
          {
            paymentId: PAYMENT_2_ID,
          },
        ]),
        findById: jest
          .fn()
          .mockResolvedValueOnce(createPaymentRecord())
          .mockResolvedValueOnce(
            createPaymentRecord({
              id: PAYMENT_2_ID,
              postingId: POSTING_2_ID,
            }),
          ),
      },
      provider: {
        getPaymentStatus: jest.fn(async () => ({
          providerPaymentId: SQUARE_PAY_1_ID,
          providerOrderId: "square-order-1",
          status: "PENDING",
          raw: {},
        })),
      },
    });

    const processed = await service.processRepairQueue(2);

    expect(processed).toBe(2);
    expect(
      paymentsRepository.listRepairCandidates as unknown as jest.Mock,
    ).toHaveBeenCalledWith(2);
  });

  it("marks due payouts released and records failures", async () => {
    const { service, paymentsRepository } = createService({
      repository: {
        listDuePayouts: jest.fn(async () => [
          {
            id: PAYOUT_1_ID,
          },
          {
            id: PAYOUT_2_ID,
          },
        ]),
        markPayoutReleased: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("bank offline")),
      },
    });

    const processed = await service.processDuePayouts(2);

    expect(processed).toBe(2);
    expect(
      paymentsRepository.markPayoutReleased as unknown as jest.Mock,
    ).toHaveBeenCalledTimes(2);
    expect(
      paymentsRepository.markPayoutFailed as unknown as jest.Mock,
    ).toHaveBeenCalledWith(PAYOUT_2_ID, "bank offline");
  });

  describe("getPaymentByBookingRequest", () => {
    it("returns the payment for the renter without requiring org membership", async () => {
      const { service, paymentsRepository, organizationAccessService } =
        createService({
          repository: {
            findByBookingRequestId: jest.fn(async () =>
              createPaymentRecord({ renterId: RENTER_1_ID }),
            ),
          },
        });

      const result = await service.getPaymentByBookingRequest(
        BOOKING_1_ID,
        RENTER_1_ID,
      );

      expect(result.id).toBe(PAYMENT_1_ID);
      expect(
        paymentsRepository.findByBookingRequestId as unknown as jest.Mock,
      ).toHaveBeenCalledWith(BOOKING_1_ID);
      expect(
        organizationAccessService.requireMembership as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("returns the payment for an organization member", async () => {
      const { service, organizationAccessService } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () =>
            createPaymentRecord({ renterId: RENTER_1_ID }),
          ),
        },
      });

      const result = await service.getPaymentByBookingRequest(
        BOOKING_1_ID,
        MANAGER_1_ID,
      );

      expect(result.id).toBe(PAYMENT_1_ID);
      expect(
        organizationAccessService.requireMembership as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        MANAGER_1_ID,
        ORG_1_ID,
        "You do not have access to this payment.",
      );
    });

    it("rejects a caller who is neither the renter nor an org member", async () => {
      const { service } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () =>
            createPaymentRecord({ renterId: RENTER_1_ID }),
          ),
        },
        orgAccess: {
          requireMembership: jest.fn(async () => {
            throw new ForbiddenError("You do not have access to this payment.");
          }),
        },
      });

      await expect(
        service.getPaymentByBookingRequest(BOOKING_1_ID, STRANGER_1_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws when no payment exists for the booking request", async () => {
      const { service } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => null),
        },
      });

      await expect(
        service.getPaymentByBookingRequest(BOOKING_MISSING_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
