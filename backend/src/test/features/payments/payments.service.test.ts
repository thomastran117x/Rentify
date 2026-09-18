import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import type { CacheService } from "@/features/cache/cache.service";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import { PaymentsService } from "@/features/payments/payments.service";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { getEnvironment } from "@/configuration/environment/index";
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
const CAPTURE_1_ID = testUuid(9200, 565949);
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
    provider: "paypal" as const,
    status: "succeeded" as const,
    pricingCurrency: "CAD",
    rentalSubtotalAmount: 100,
    platformFeeAmount: 10,
    totalAmount: 110,
    providerPaymentId: CAPTURE_1_ID,
    providerOrderId: "order-1",
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

/** A GET order response for an approved, not yet captured order. */
function approvedOrder(overrides: Record<string, unknown> = {}) {
  return {
    providerOrderId: "order-1",
    status: "APPROVED" as const,
    raw: {},
    order: {
      paymentSource: "paypal" as const,
      customId: PAYMENT_1_ID,
      amount: 110,
      currency: "CAD",
    },
    ...overrides,
  };
}

function createCheckoutContext(
  overrides: {
    booking?: Record<string, unknown>;
    posting?: Record<string, unknown>;
    payment?: unknown;
  } = {},
) {
  return {
    booking: {
      id: BOOKING_1_ID,
      renterId: RENTER_1_ID,
      status: "awaiting_payment",
      startAt: new Date("2099-05-01T00:00:00.000Z"),
      endAt: new Date("2099-05-11T00:00:00.000Z"),
      durationDays: 10,
      guestCount: 2,
      holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
      dailyPriceAmount: 100,
      estimatedTotal: 1000,
      pricingCurrency: "CAD",
      converted: false,
      paymentReconciliationRequired: false,
      ...overrides.booking,
    },
    posting: {
      id: POSTING_1_ID,
      name: "Lakeside cabin",
      primaryPhotoUrl: "https://blob.example/photo.jpg",
      cancellationPolicyNotes: "Check-in after 4pm.",
      ...overrides.posting,
    },
    payment: overrides.payment ?? null,
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
    findByBookingRequestId: jest.fn(async () => null),
    findCheckoutContext: jest.fn(async () => createCheckoutContext()),
    rejectCheckoutAttempt: jest.fn(async () =>
      createPaymentRecord({ status: "failed_final" }),
    ),
    findByProviderReferences: jest.fn(async () => createPaymentRecord()),
    findRefundByProviderRefundId: jest.fn(async () => null),
    createRefundRecord: jest.fn(async () => ({
      refundId: REFUND_1_ID,
      paymentId: PAYMENT_1_ID,
      providerPaymentId: CAPTURE_1_ID,
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
      providerPaymentId: CAPTURE_1_ID,
      providerOrderId: "order-1",
      checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order-1",
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
      providerRefundId: "refund-provider-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    })),
    verifyWebhookSignature: jest.fn(() => ({
      payload: { resource: { id: CAPTURE_1_ID } },
      details: {
        providerPaymentId: CAPTURE_1_ID,
        providerOrderId: "order-1",
        status: "COMPLETED",
      },
      eventId: "event-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      isValid: true,
    })),
    capturePayment: jest.fn(async () => ({
      providerPaymentId: CAPTURE_1_ID,
      providerOrderId: "order-1",
      status: "COMPLETED",
      raw: {},
    })),
    getPaymentStatus: jest.fn(async () => ({
      providerPaymentId: CAPTURE_1_ID,
      providerOrderId: "order-1",
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
        providerPaymentId: CAPTURE_1_ID,
      }),
      { expectedProviderOrderId: "order-1" },
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
          throw new Error("paypal unavailable");
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
      { scheduleRetry: true },
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
        providerPaymentId: CAPTURE_1_ID,
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
          payload: { resource: { id: CAPTURE_1_ID } },
          details: {
            providerPaymentId: CAPTURE_1_ID,
            providerOrderId: "order-1",
            status: "COMPLETED",
          },
          eventId: "event-1",
          eventType: "PAYMENT.CAPTURE.COMPLETED",
          isValid: false,
        })),
      },
    });

    await expect(
      service.processPaymentWebhook("{}", {
        "paypal-transmission-sig": "bad-sig",
      }),
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

    await service.processPaymentWebhook("{}", {});

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
          payload: { resource: { id: CAPTURE_1_ID } },
          details: {
            providerPaymentId: CAPTURE_1_ID,
            providerOrderId: "order-1",
            status: "FAILED",
          },
          eventId: "event-2",
          eventType: "PAYMENT.CAPTURE.DENIED",
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

    await service.processPaymentWebhook("{}", {});

    expect(
      paymentsRepository.markPaymentFailed as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        failureCode: "PAYMENT.CAPTURE.DENIED",
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
      (cacheService.acquireLock as unknown as jest.Mock).mock.calls.map(
        (call) => call[0],
      ),
    ).toEqual([
      `booking-request:${BOOKING_1_ID}:state`,
      `posting:${POSTING_1_ID}:booking-window`,
    ]);
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
      service.processPaymentWebhook("{}", {}),
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
        providerPaymentId: CAPTURE_1_ID,
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
          providerPaymentId: CAPTURE_1_ID,
          providerOrderId: "order-1",
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

  describe("capturePayment", () => {
    it("rejects capture by members who cannot manage the organization's payments", async () => {
      const { service, paymentProvider, organizationAccessService } =
        createService({
          repository: {
            findById: jest.fn(async () =>
              createPaymentRecord({ status: "processing" }),
            ),
          },
          orgAccess: {
            assertCanManage: jest.fn(() => {
              throw new ForbiddenError(
                "You do not have permission to manage this payment.",
              );
            }),
          },
        });

      await expect(
        service.capturePayment(PAYMENT_1_ID, MANAGER_1_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        organizationAccessService.requireMembership as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        MANAGER_1_ID,
        ORG_1_ID,
        "You do not have access to this payment.",
      );
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("captures the approved order and finalizes the payment", async () => {
      const { service, paymentProvider, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => approvedOrder()),
        },
      });

      const result = await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).toHaveBeenCalledWith({
        providerOrderId: "order-1",
        idempotencyKey: "capture-order-1",
      });
      expect(
        paymentsRepository.markPaymentSucceeded as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          providerPaymentId: CAPTURE_1_ID,
          status: "COMPLETED",
        }),
      );
      expect(result.status).toBe("succeeded");
    });

    it("returns an already captured payment without calling the provider", async () => {
      const { service, paymentProvider } = createService();

      const result = await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(result.status).toBe("succeeded");
    });

    it("rejects capture when the payment has no provider order", async () => {
      const { service } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({
              status: "awaiting_method",
              providerOrderId: undefined,
            }),
          ),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("marks the payment failed when PayPal rejects the capture", async () => {
      const { service, paymentsRepository, analyticsRepository } =
        createService({
          repository: {
            findById: jest.fn(async () =>
              createPaymentRecord({ status: "processing" }),
            ),
          },
          provider: {
            getPaymentStatus: jest.fn(async () => approvedOrder()),
            capturePayment: jest.fn(async () => {
              throw new Error("declined");
            }),
            classifyError: jest.fn(() => ({
              category: "permanent",
              code: "INSTRUMENT_DECLINED",
              message: "The instrument presented was declined.",
              retryable: false,
            })),
          },
        });

      const result = await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOrderId: "order-1",
          status: "FAILED",
          failureCode: "INSTRUMENT_DECLINED",
        }),
        "permanent",
      );
      expect(
        analyticsRepository.enqueuePaymentFailedEvent as unknown as jest.Mock,
      ).toHaveBeenCalled();
      expect(result.status).toBe("failed_final");
    });

    it("falls back to the stored payment when a rejected capture matches nothing", async () => {
      const payment = createPaymentRecord({ status: "processing" });
      const { service } = createService({
        repository: {
          findById: jest.fn(async () => payment),
          markPaymentFailed: jest.fn(async () => null),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => approvedOrder()),
          capturePayment: jest.fn(async () => {
            throw new Error("declined");
          }),
          classifyError: jest.fn(() => ({
            category: "permanent",
            message: "declined",
            retryable: false,
          })),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).resolves.toBe(payment);
    });

    it("surfaces transient capture failures as service unavailable", async () => {
      const { service, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => approvedOrder()),
          capturePayment: jest.fn(async () => {
            throw new Error("paypal down");
          }),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ServiceNotAvaliableError);
      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("throws ConflictError when the captured booking needs reconciliation", async () => {
      const { service } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
          markPaymentSucceeded: jest.fn(async () => ({
            payment: createPaymentRecord(),
            reconciliationRequired: true,
          })),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("leaves the payment unchanged while the capture is pending", async () => {
      const payment = createPaymentRecord({ status: "processing" });
      const { service, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () => payment),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => approvedOrder()),
          capturePayment: jest.fn(async () => ({
            providerPaymentId: CAPTURE_1_ID,
            providerOrderId: "order-1",
            status: "PENDING",
            raw: {},
          })),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).resolves.toBe(payment);
      expect(
        paymentsRepository.markPaymentSucceeded as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("falls back to the stored payment when a completed capture matches nothing", async () => {
      const payment = createPaymentRecord({ status: "processing" });
      const { service } = createService({
        repository: {
          findById: jest.fn(async () => payment),
          markPaymentSucceeded: jest.fn(async () => ({
            payment: null,
            reconciliationRequired: false,
          })),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).resolves.toBe(payment);
    });
  });

  it("captures approved orders reported by webhook", async () => {
    const { service, paymentProvider, paymentsRepository } = createService({
      repository: {
        findByProviderReferences: jest.fn(async () =>
          createPaymentRecord({ status: "processing" }),
        ),
      },
      provider: {
        getPaymentStatus: jest.fn(async () => approvedOrder()),
        verifyWebhookSignature: jest.fn(async () => ({
          payload: { resource: { id: "order-1" } },
          details: { providerOrderId: "order-1", status: "APPROVED" },
          eventId: "event-3",
          eventType: "CHECKOUT.ORDER.APPROVED",
          isValid: true,
        })),
      },
    });

    await service.processPaymentWebhook("{}", {});

    expect(
      paymentProvider.capturePayment as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      providerOrderId: "order-1",
      idempotencyKey: "capture-order-1",
    });
    expect(
      paymentsRepository.markPaymentSucceeded as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).toHaveBeenCalledWith("event-3");
  });

  it("skips capture for approved webhooks without a matching payment", async () => {
    const { service, paymentProvider, paymentsRepository } = createService({
      repository: {
        findByProviderReferences: jest.fn(async () => null),
      },
      provider: {
        verifyWebhookSignature: jest.fn(async () => ({
          payload: {},
          details: { providerOrderId: "order-unknown", status: "APPROVED" },
          eventId: "event-4",
          eventType: "CHECKOUT.ORDER.APPROVED",
          isValid: true,
        })),
      },
    });

    await service.processPaymentWebhook("{}", {});

    expect(
      paymentProvider.capturePayment as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).toHaveBeenCalledWith("event-4");
  });

  it("records webhook events that carry no payment status", async () => {
    const { service, paymentsRepository } = createService({
      provider: {
        verifyWebhookSignature: jest.fn(async () => ({
          payload: {},
          details: {},
          eventId: "event-5",
          eventType: "PAYMENT.CAPTURE.REFUNDED",
          isValid: true,
        })),
      },
    });

    await service.processPaymentWebhook("{}", {});

    expect(
      paymentsRepository.markPaymentSucceeded as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(
      paymentsRepository.markPaymentFailed as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).toHaveBeenCalledWith("event-5");
  });

  it("captures approved orders found during reconciliation", async () => {
    const { service, paymentProvider } = createService({
      repository: {
        findById: jest.fn(async () =>
          createPaymentRecord({ status: "processing" }),
        ),
      },
      provider: {
        getPaymentStatus: jest.fn(async () => ({
          providerOrderId: "order-1",
          status: "APPROVED",
          raw: {},
        })),
      },
    });

    const result = await service.reconcilePayment(PAYMENT_1_ID, RENTER_1_ID);

    expect(
      paymentProvider.capturePayment as unknown as jest.Mock,
    ).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("succeeded");
  });

  it("does not re-capture when PayPal still reports the order as approved", async () => {
    const { service, paymentProvider, paymentsRepository } = createService({
      provider: {
        getPaymentStatus: jest.fn(async () => ({
          status: "APPROVED",
          raw: {},
        })),
        capturePayment: jest.fn(async () => ({
          providerOrderId: "order-1",
          status: "APPROVED",
          raw: {},
        })),
      },
    });

    await service.repairPayment(PAYMENT_1_ID);

    expect(
      paymentProvider.capturePayment as unknown as jest.Mock,
    ).toHaveBeenCalledTimes(1);
    expect(
      paymentsRepository.markPaymentSucceeded as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  it("does not capture approved statuses when no order reference is known", async () => {
    const { service, paymentProvider } = createService({
      repository: {
        findById: jest.fn(async () =>
          createPaymentRecord({ providerOrderId: undefined }),
        ),
      },
      provider: {
        getPaymentStatus: jest.fn(async () => ({
          status: "APPROVED",
          raw: {},
        })),
      },
    });

    await service.repairPayment(PAYMENT_1_ID);

    expect(
      paymentProvider.capturePayment as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  it("records failed provider statuses found during repair", async () => {
    const { service, paymentsRepository } = createService({
      provider: {
        getPaymentStatus: jest.fn(async () => ({
          providerPaymentId: CAPTURE_1_ID,
          status: "FAILED",
          raw: {},
        })),
      },
    });

    await service.repairPayment(PAYMENT_1_ID);

    expect(
      paymentsRepository.markPaymentFailed as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
      "permanent",
    );
  });

  it("skips repair when the payment or provider record is missing", async () => {
    const missingPayment = createService({
      repository: {
        findById: jest.fn(async () => null),
      },
    });
    await missingPayment.service.repairPayment(PAYMENT_1_ID);
    expect(
      missingPayment.paymentProvider.getPaymentStatus as unknown as jest.Mock,
    ).not.toHaveBeenCalled();

    const missingStatus = createService({
      provider: {
        getPaymentStatus: jest.fn(async () => null),
      },
    });
    await missingStatus.service.repairPayment(PAYMENT_1_ID);
    expect(
      missingStatus.paymentsRepository
        .markPaymentSucceeded as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  it("throws when a cancelled reconciliation matches no payment", async () => {
    const { service } = createService({
      repository: {
        markPaymentFailed: jest.fn(async () => null),
      },
      provider: {
        getPaymentStatus: jest.fn(async () => ({
          providerOrderId: "order-1",
          status: "CANCELED",
          raw: {},
        })),
      },
    });

    await expect(
      service.reconcilePayment(PAYMENT_1_ID, RENTER_1_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("does not record refund analytics while PayPal reports the refund pending", async () => {
    const { service, analyticsRepository, paymentsRepository } = createService({
      provider: {
        createRefund: jest.fn(async () => ({
          providerRefundId: "refund-provider-1",
          status: "PENDING",
          raw: {},
        })),
      },
    });

    await service.createRefund({
      paymentId: PAYMENT_1_ID,
      actorUserId: RENTER_1_ID,
      amount: 42,
    });

    expect(
      paymentsRepository.completeRefund as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      REFUND_1_ID,
      expect.objectContaining({ status: "PENDING" }),
    );
    expect(
      analyticsRepository.enqueueRefundRecordedEvent as unknown as jest.Mock,
    ).not.toHaveBeenCalled();
  });

  describe("cancelCheckout", () => {
    it("marks an unapproved checkout cancelled so it can be retried", async () => {
      const { service, paymentProvider, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "PENDING",
            raw: {},
          })),
        },
      });

      const result = await service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).toHaveBeenCalledWith({ providerOrderId: "order-1" });
      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOrderId: "order-1",
          status: "CANCELED",
          failureCode: "CHECKOUT_CANCELLED",
        }),
        "unknown",
      );
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(result.status).toBe("failed_final");
    });

    it("cancels checkouts PayPal has no record of", async () => {
      const payment = createPaymentRecord({ status: "processing" });
      const { service } = createService({
        repository: {
          findById: jest.fn(async () => payment),
          markPaymentFailed: jest.fn(async () => null),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => null),
        },
      });

      await expect(
        service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID),
      ).resolves.toBe(payment);
    });

    it("captures instead when PayPal shows the order was approved", async () => {
      const { service, paymentProvider, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "APPROVED",
            raw: {},
          })),
        },
      });

      const result = await service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).toHaveBeenCalledTimes(1);
      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(result.status).toBe("succeeded");
    });

    it("throws ConflictError when an approved checkout needs reconciliation", async () => {
      const { service } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
          markPaymentSucceeded: jest.fn(async () => ({
            payment: createPaymentRecord(),
            reconciliationRequired: true,
          })),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "COMPLETED",
            raw: {},
          })),
        },
      });

      await expect(
        service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("falls back to the stored payment when a provider outcome matches nothing", async () => {
      const payment = createPaymentRecord({ status: "processing" });
      const { service } = createService({
        repository: {
          findById: jest.fn(async () => payment),
          markPaymentFailed: jest.fn(async () => null),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "FAILED",
            raw: {},
          })),
        },
      });

      await expect(
        service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID),
      ).resolves.toBe(payment);
    });

    it("refuses to cancel an order a newer checkout replaced", async () => {
      const { service, paymentProvider, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({
              status: "processing",
              providerOrderId: "order-2",
            }),
          ),
        },
      });

      const error = await service
        .cancelCheckout(PAYMENT_1_ID, RENTER_1_ID, { orderId: "order-1" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toEqual({
        reason: "stale_order",
      });
      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("cancels the order the renter actually abandoned", async () => {
      const { service, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({
              status: "processing",
              providerOrderId: "order-1",
            }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "PENDING",
            raw: {},
          })),
        },
      });

      await service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID, {
        orderId: "order-1",
      });

      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ failureCode: "CHECKOUT_CANCELLED" }),
        "unknown",
      );
    });

    it("leaves payments that are no longer awaiting checkout unchanged", async () => {
      const { service, paymentProvider } = createService();

      const result = await service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID);

      expect(result.status).toBe("succeeded");
      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("surfaces PayPal lookup failures as service unavailable", async () => {
      const { service } = createService({
        repository: {
          findById: jest.fn(async () =>
            createPaymentRecord({ status: "processing" }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => {
            throw new Error("paypal down");
          }),
        },
      });

      await expect(
        service.cancelCheckout(PAYMENT_1_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ServiceNotAvaliableError);
    });

    it("requires manage access for organization members", async () => {
      const { service } = createService({
        orgAccess: {
          assertCanManage: jest.fn(() => {
            throw new ForbiddenError(
              "You do not have permission to manage this payment.",
            );
          }),
        },
      });

      await expect(
        service.cancelCheckout(PAYMENT_1_ID, MANAGER_1_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("refund webhooks", () => {
    function refundWebhook(status: "COMPLETED" | "FAILED" | "PENDING") {
      return jest.fn(async () => ({
        payload: { resource: { id: "refund-provider-1", status } },
        details: {
          refund: { providerRefundId: "refund-provider-1", status },
        },
        eventId: "event-refund",
        eventType: "PAYMENT.CAPTURE.REFUNDED",
        isValid: true,
      }));
    }

    it("finalizes a pending refund when PayPal reports it completed", async () => {
      const { service, paymentsRepository, analyticsRepository } =
        createService({
          repository: {
            findByProviderReferences: jest.fn(async () => null),
            findRefundByProviderRefundId: jest.fn(async () => ({
              refundId: REFUND_1_ID,
              paymentId: PAYMENT_1_ID,
              status: "pending",
            })),
            completeRefund: jest.fn(async () =>
              createPaymentRecord({
                status: "refunded",
                refunds: [{ id: REFUND_1_ID, amount: 42 }],
              }),
            ),
          },
          provider: {
            verifyWebhookSignature: refundWebhook("COMPLETED"),
          },
        });

      await service.processPaymentWebhook("{}", {});

      expect(
        paymentsRepository.upsertWebhookEvent as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: PAYMENT_1_ID }),
      );
      expect(
        paymentsRepository.completeRefund as unknown as jest.Mock,
      ).toHaveBeenCalledWith(REFUND_1_ID, {
        providerRefundId: "refund-provider-1",
        status: "COMPLETED",
        raw: { resource: { id: "refund-provider-1", status: "COMPLETED" } },
      });
      expect(
        analyticsRepository.enqueueRefundRecordedEvent as unknown as jest.Mock,
      ).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: 42 }));
      expect(
        paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
      ).toHaveBeenCalledWith("event-refund");
    });

    it("records zero refunded analytics when the refund is missing from the payment", async () => {
      const { service, analyticsRepository } = createService({
        repository: {
          findRefundByProviderRefundId: jest.fn(async () => ({
            refundId: REFUND_1_ID,
            paymentId: PAYMENT_1_ID,
            status: "pending",
          })),
        },
        provider: {
          verifyWebhookSignature: refundWebhook("COMPLETED"),
        },
      });

      await service.processPaymentWebhook("{}", {});

      expect(
        analyticsRepository.enqueueRefundRecordedEvent as unknown as jest.Mock,
      ).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: 0 }));
    });

    it("records failed refunds without refund analytics", async () => {
      const { service, paymentsRepository, analyticsRepository } =
        createService({
          repository: {
            findRefundByProviderRefundId: jest.fn(async () => ({
              refundId: REFUND_1_ID,
              paymentId: PAYMENT_1_ID,
              status: "pending",
            })),
          },
          provider: {
            verifyWebhookSignature: refundWebhook("FAILED"),
          },
        });

      await service.processPaymentWebhook("{}", {});

      expect(
        paymentsRepository.completeRefund as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        REFUND_1_ID,
        expect.objectContaining({ status: "FAILED" }),
      );
      expect(
        analyticsRepository.enqueueRefundRecordedEvent as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("ignores refunds that already settled or are still pending", async () => {
      const settled = createService({
        repository: {
          findRefundByProviderRefundId: jest.fn(async () => ({
            refundId: REFUND_1_ID,
            paymentId: PAYMENT_1_ID,
            status: "succeeded",
          })),
        },
        provider: {
          verifyWebhookSignature: refundWebhook("COMPLETED"),
        },
      });
      await settled.service.processPaymentWebhook("{}", {});
      expect(
        settled.paymentsRepository.completeRefund as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        settled.paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
      ).toHaveBeenCalledWith("event-refund");

      const stillPending = createService({
        repository: {
          findRefundByProviderRefundId: jest.fn(async () => ({
            refundId: REFUND_1_ID,
            paymentId: PAYMENT_1_ID,
            status: "pending",
          })),
        },
        provider: {
          verifyWebhookSignature: refundWebhook("PENDING"),
        },
      });
      await stillPending.service.processPaymentWebhook("{}", {});
      expect(
        stillPending.paymentsRepository.completeRefund as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("leaves refund events Rentify has no record of unprocessed", async () => {
      const { service, paymentsRepository } = createService({
        provider: {
          verifyWebhookSignature: refundWebhook("COMPLETED"),
        },
      });

      await service.processPaymentWebhook("{}", {});

      expect(
        paymentsRepository.upsertWebhookEvent as unknown as jest.Mock,
      ).toHaveBeenCalled();
      expect(
        paymentsRepository.completeRefund as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });
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
  describe("embedded checkout", () => {
    function processingPayment(overrides: Record<string, unknown> = {}) {
      return createPaymentRecord({
        status: "processing",
        providerPaymentId: undefined,
        booking: {
          id: BOOKING_1_ID,
          status: "payment_processing",
          startAt: "2099-05-01T00:00:00.000Z",
          endAt: "2099-05-04T00:00:00.000Z",
          holdExpiresAt: "2099-04-21T00:00:00.000Z",
          paymentReconciliationRequired: false,
        },
        ...overrides,
      });
    }

    it("passes the chosen method to the repository and provider without scheduling retries", async () => {
      const { service, paymentsRepository, paymentProvider } = createService({
        provider: {
          createPaymentSession: jest.fn(async () => {
            throw new Error("paypal down");
          }),
        },
      });

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-card",
        method: "card",
      });

      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ method: "card", supersede: undefined }),
      );
      expect(
        paymentProvider.createPaymentSession as unknown as jest.Mock,
      ).toHaveBeenCalledWith(expect.objectContaining({ method: "card" }));
      expect(
        paymentsRepository.recordAttemptFailure as unknown as jest.Mock,
      ).toHaveBeenCalledWith(PAYMENT_1_ID, ATTEMPT_1_ID, expect.anything(), {
        scheduleRetry: false,
      });
    });

    it("only attaches a session while the attempt is still the live checkout", async () => {
      const { service, paymentsRepository } = createService();

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-1",
        method: "paypal",
      });

      expect(
        paymentsRepository.attachPaymentSession as unknown as jest.Mock,
      ).toHaveBeenCalledWith(PAYMENT_1_ID, ATTEMPT_1_ID, expect.anything(), {
        expectedProviderOrderId: "order-1",
      });
    });

    it("renews the checkout lock while the provider call is in flight", async () => {
      jest.useFakeTimers();
      const extend = jest.fn(async () => true);
      const release = jest.fn(async () => true);
      let finishProvider: () => void = () => undefined;
      const { service } = createService({
        cache: {
          acquireLock: jest.fn(async (key: string) => ({
            key,
            token: "token",
            release,
            extend,
          })),
        },
        provider: {
          createPaymentSession: jest.fn(
            async () =>
              new Promise((resolve) => {
                finishProvider = () =>
                  resolve({ providerOrderId: "order-1", raw: {} });
              }),
          ),
        },
      });

      try {
        const pending = service.createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-slow",
          method: "paypal",
        });

        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(12_000);
        expect(extend.mock.calls.length).toBeGreaterThanOrEqual(2);

        finishProvider();
        await pending;
        expect(release).toHaveBeenCalled();

        extend.mockClear();
        await jest.advanceTimersByTimeAsync(30_000);
        expect(extend).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("rejects methods that are not enabled for checkout", async () => {
      const paypal = getEnvironment().paypal;
      const original = [...paypal.checkoutMethods];
      paypal.checkoutMethods.splice(0, paypal.checkoutMethods.length, "paypal");
      const { service, paymentsRepository } = createService();

      try {
        await expect(
          service.createPaymentSession({
            bookingRequestId: BOOKING_1_ID,
            renterId: RENTER_1_ID,
            method: "apple_pay",
          }),
        ).rejects.toBeInstanceOf(BadRequestError);
      } finally {
        paypal.checkoutMethods.splice(
          0,
          paypal.checkoutMethods.length,
          ...original,
        );
      }

      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("reports a busy checkout when the booking lock is held", async () => {
      const { service } = createService({
        cache: {
          acquireLock: jest.fn(async () => null),
        },
      });

      const error = await service
        .createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          method: "paypal",
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toEqual({
        reason: "checkout_busy",
      });
    });

    it("supersedes an unapproved order before creating a new one", async () => {
      const { service, paymentsRepository } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "PENDING",
            raw: {},
          })),
        },
      });

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-2",
        method: "card",
      });

      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          supersede: { expectedProviderOrderId: "order-1" },
        }),
      );
    });

    it("supersedes orders PayPal no longer knows about", async () => {
      const { service, paymentsRepository } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => null),
        },
      });

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-2",
        method: "paypal",
      });

      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          supersede: { expectedProviderOrderId: "order-1" },
        }),
      );
    });

    it("supersedes without asking PayPal when no order was attached", async () => {
      const { service, paymentsRepository, paymentProvider } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () =>
            processingPayment({
              status: "awaiting_method",
              providerOrderId: undefined,
            }),
          ),
        },
      });

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-2",
        method: "paypal",
      });

      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          supersede: { expectedProviderOrderId: null },
        }),
      );
    });

    it("does not look up the provider for replays, strangers, or idle payments", async () => {
      const replay = processingPayment({
        attempts: [{ id: ATTEMPT_1_ID, idempotencyKey: "idem-1" }],
      });

      for (const payment of [
        replay,
        processingPayment({ renterId: STRANGER_1_ID }),
        createPaymentRecord({ status: "failed_final" }),
      ]) {
        const { service, paymentProvider } = createService({
          repository: {
            findByBookingRequestId: jest.fn(async () => payment),
          },
        });

        await service.createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-1",
          method: "paypal",
        });

        expect(
          paymentProvider.getPaymentStatus as unknown as jest.Mock,
        ).not.toHaveBeenCalled();
      }
    });

    it("captures an already approved order instead of replacing it", async () => {
      const { service, paymentsRepository, paymentProvider } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => approvedOrder()),
        },
      });

      const error = await service
        .createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-2",
          method: "card",
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toEqual({
        reason: "payment_in_progress",
      });
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).toHaveBeenCalledWith({
        providerOrderId: "order-1",
        idempotencyKey: "capture-order-1",
      });
      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("refuses to replace an order whose capture is still settling", async () => {
      const { service } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            providerPaymentId: CAPTURE_1_ID,
            status: "PENDING",
            raw: {},
          })),
        },
      });

      await expect(
        service.createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-2",
          method: "paypal",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("surfaces reconciliation when the old order completed into a conflict", async () => {
      const { service } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
          markPaymentSucceeded: jest.fn(async () => ({
            payment: createPaymentRecord(),
            reconciliationRequired: true,
          })),
        },
      });

      const error = await service
        .createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-2",
          method: "paypal",
        })
        .catch((caught: unknown) => caught);

      expect((error as ConflictError).details).toEqual({
        reason: "reconciliation_required",
      });
    });

    it("continues with a new order once the old order is found declined", async () => {
      const { service, paymentsRepository } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "FAILED",
            raw: {},
          })),
        },
      });

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-2",
        method: "paypal",
      });

      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).toHaveBeenCalled();
      expect(
        paymentsRepository.createPaymentAttemptForBooking as unknown as jest.Mock,
      ).toHaveBeenCalledWith(expect.objectContaining({ supersede: undefined }));
    });

    it("surfaces PayPal lookup failures while settling an open order", async () => {
      const { service } = createService({
        repository: {
          findByBookingRequestId: jest.fn(async () => processingPayment()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => {
            throw new Error("paypal down");
          }),
        },
      });

      await expect(
        service.createPaymentSession({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-2",
          method: "paypal",
        }),
      ).rejects.toBeInstanceOf(ServiceNotAvaliableError);
    });

    it("returns an existing attempt that already has an order", async () => {
      const { service, paymentProvider } = createService({
        repository: {
          createPaymentAttemptForBooking: jest.fn(async () => ({
            paymentId: PAYMENT_1_ID,
            attemptId: ATTEMPT_1_ID,
            amount: 110,
            currency: "CAD",
            payment: processingPayment({
              attempts: [{ id: ATTEMPT_1_ID, providerOrderId: "order-1" }],
            }),
          })),
        },
      });

      await service.createPaymentSession({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-1",
        method: "paypal",
      });

      expect(
        paymentProvider.createPaymentSession as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });
  });

  describe("capture guards", () => {
    function capturable(overrides: Record<string, unknown> = {}) {
      return createPaymentRecord({
        status: "processing",
        providerPaymentId: undefined,
        booking: {
          id: BOOKING_1_ID,
          status: "payment_processing",
          startAt: "2099-05-01T00:00:00.000Z",
          endAt: "2099-05-04T00:00:00.000Z",
          holdExpiresAt: "2099-04-21T00:00:00.000Z",
          paymentReconciliationRequired: false,
        },
        ...overrides,
      });
    }

    it("rejects a capture for an order that a newer checkout replaced", async () => {
      const { service, paymentProvider } = createService({
        repository: {
          findById: jest.fn(async () => capturable()),
        },
      });

      const error = await service
        .capturePayment(PAYMENT_1_ID, RENTER_1_ID, { orderId: "order-old" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toEqual({
        reason: "stale_order",
      });
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("leaves a payment unchanged while its order is not yet approved", async () => {
      const payment = capturable();
      const { service, paymentProvider, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () => payment),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => ({
            providerOrderId: "order-1",
            status: "PENDING",
            raw: {},
          })),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID, {
          orderId: "order-1",
        }),
      ).resolves.toBe(payment);
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentsRepository.markPaymentFailed as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("leaves a payment unchanged when PayPal has no record of the order", async () => {
      const payment = capturable();
      const { service, paymentProvider } = createService({
        repository: {
          findById: jest.fn(async () => payment),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => null),
        },
      });

      await expect(
        service.capturePayment(PAYMENT_1_ID, RENTER_1_ID),
      ).resolves.toBe(payment);
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("refuses to capture once the booking hold has expired", async () => {
      const { service, paymentProvider, paymentsRepository } = createService({
        repository: {
          findById: jest.fn(async () =>
            capturable({
              booking: {
                id: BOOKING_1_ID,
                status: "payment_processing",
                startAt: "2099-05-01T00:00:00.000Z",
                endAt: "2099-05-04T00:00:00.000Z",
                holdExpiresAt: "2020-01-01T00:00:00.000Z",
                paymentReconciliationRequired: false,
              },
            }),
          ),
        },
        provider: {
          getPaymentStatus: jest.fn(async () => approvedOrder()),
        },
      });

      const result = await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentsRepository.rejectCheckoutAttempt as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOrderId: "order-1",
          failureCode: "HOLD_EXPIRED",
        }),
      );
      expect(result.status).toBe("failed_final");
    });

    it("refuses to capture for a booking that is no longer payable", async () => {
      const { service, paymentProvider } = createService({
        repository: {
          findById: jest.fn(async () =>
            capturable({
              booking: {
                id: BOOKING_1_ID,
                status: "expired",
                startAt: "2099-05-01T00:00:00.000Z",
                endAt: "2099-05-04T00:00:00.000Z",
                holdExpiresAt: "2099-04-21T00:00:00.000Z",
                paymentReconciliationRequired: false,
              },
            }),
          ),
        },
      });

      await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it.each([
      ["custom id", { customId: PAYMENT_2_ID }],
      ["amount", { amount: 999 }],
      ["currency", { currency: "USD" }],
    ])(
      "refuses to capture an order whose %s does not match the payment",
      async (_label, mismatch) => {
        const { service, paymentProvider, paymentsRepository } = createService({
          repository: {
            findById: jest.fn(async () => capturable()),
          },
          provider: {
            getPaymentStatus: jest.fn(async () =>
              approvedOrder({
                order: {
                  paymentSource: "paypal",
                  customId: PAYMENT_1_ID,
                  amount: 110,
                  currency: "CAD",
                  ...mismatch,
                },
              }),
            ),
          },
        });

        await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

        expect(
          paymentProvider.capturePayment as unknown as jest.Mock,
        ).not.toHaveBeenCalled();
        expect(
          paymentsRepository.rejectCheckoutAttempt as unknown as jest.Mock,
        ).toHaveBeenCalledWith(
          expect.objectContaining({ failureCode: "ORDER_MISMATCH" }),
        );
      },
    );

    it("captures card orders whose 3-D Secure shifted liability", async () => {
      const { service, paymentProvider } = createService({
        repository: {
          findById: jest.fn(async () => capturable()),
        },
        provider: {
          getPaymentStatus: jest.fn(async () =>
            approvedOrder({
              order: {
                paymentSource: "card",
                customId: PAYMENT_1_ID,
                amount: 110,
                currency: "CAD",
                cardAuthentication: {
                  liabilityShift: "POSSIBLE",
                  enrollmentStatus: "Y",
                  authenticationStatus: "Y",
                },
              },
            }),
          ),
        },
      });

      await service.capturePayment(PAYMENT_1_ID, RENTER_1_ID);

      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).toHaveBeenCalled();
    });

    it("never captures a card order that failed 3-D Secure, even from a webhook", async () => {
      const {
        service,
        paymentProvider,
        paymentsRepository,
        analyticsRepository,
      } = createService({
        repository: {
          findByProviderReferences: jest.fn(async () => capturable()),
        },
        provider: {
          verifyWebhookSignature: jest.fn(async () => ({
            payload: { resource: { id: "order-1" } },
            details: { providerOrderId: "order-1", status: "APPROVED" },
            eventId: "event-3ds",
            eventType: "CHECKOUT.ORDER.APPROVED",
            isValid: true,
          })),
          getPaymentStatus: jest.fn(async () =>
            approvedOrder({
              order: {
                paymentSource: "card",
                customId: PAYMENT_1_ID,
                amount: 110,
                currency: "CAD",
                cardAuthentication: {
                  liabilityShift: "NO",
                  enrollmentStatus: "Y",
                  authenticationStatus: "N",
                },
              },
            }),
          ),
        },
      });

      await service.processPaymentWebhook("{}", {});

      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentsRepository.rejectCheckoutAttempt as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          failureCode: "CARD_AUTHENTICATION_FAILED",
        }),
      );
      expect(
        analyticsRepository.enqueuePaymentFailedEvent as unknown as jest.Mock,
      ).toHaveBeenCalled();
      expect(
        paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
      ).toHaveBeenCalledWith("event-3ds");
    });

    it("ignores approvals for orders the payment no longer tracks", async () => {
      const { service, paymentProvider } = createService({
        repository: {
          findByProviderReferences: jest.fn(async () => capturable()),
        },
        provider: {
          verifyWebhookSignature: jest.fn(async () => ({
            payload: { resource: { id: "order-old" } },
            details: { providerOrderId: "order-old", status: "APPROVED" },
            eventId: "event-old",
            eventType: "CHECKOUT.ORDER.APPROVED",
            isValid: true,
          })),
        },
      });

      await service.processPaymentWebhook("{}", {});

      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
      expect(
        paymentProvider.capturePayment as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("lets PayPal redeliver a webhook while a checkout request holds the booking", async () => {
      const { service, paymentsRepository } = createService({
        cache: {
          acquireLock: jest.fn(async () => null),
        },
      });

      await expect(
        service.processPaymentWebhook("{}", {}),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(
        paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("skips repair while a checkout request holds the booking", async () => {
      const { service, paymentProvider } = createService({
        cache: {
          acquireLock: jest.fn(async () => null),
        },
      });

      await expect(
        service.repairPayment(PAYMENT_1_ID),
      ).resolves.toBeUndefined();
      expect(
        paymentProvider.getPaymentStatus as unknown as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it("rethrows unexpected repair errors", async () => {
      const { service } = createService({
        provider: {
          getPaymentStatus: jest.fn(async () => {
            throw new Error("boom");
          }),
        },
      });

      await expect(service.repairPayment(PAYMENT_1_ID)).rejects.toThrow("boom");
    });

    it("recreates retried redirect checkouts with the redirect method", async () => {
      const { service, paymentProvider } = createService({
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

      await service.processRetryQueue(1);

      expect(
        paymentProvider.createPaymentSession as unknown as jest.Mock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ method: "paypal_redirect" }),
      );
    });
  });

  describe("getCheckoutSummary", () => {
    it("quotes the deposit, fee, and balance before any payment exists", async () => {
      const { service } = createService();

      const summary = await service.getCheckoutSummary(
        BOOKING_1_ID,
        RENTER_1_ID,
      );

      expect(summary.pricing).toEqual({
        currency: "CAD",
        stayTotal: 1000,
        depositAmount: 250,
        platformFeeAmount: 25,
        totalDueNow: 275,
        remainingBalance: 750,
        depositBps: 2500,
        platformFeeBps: 1000,
        source: "quote",
      });
      expect(summary.checkout).toEqual({ eligible: true });
      expect(summary.cancellationPolicy).toEqual({
        code: "platform_default_v1",
        fullRefundCutoffHours: 48,
        partialRefundCutoffHours: 24,
        partialRefundPercent: 50,
        ownerCancellationFullRefund: true,
        refundBase: "total_paid",
        hostNotes: "Check-in after 4pm.",
      });
      expect(summary.posting).toEqual({
        id: POSTING_1_ID,
        name: "Lakeside cabin",
        primaryPhotoUrl: "https://blob.example/photo.jpg",
      });
      expect(summary.booking).toEqual(
        expect.objectContaining({
          id: BOOKING_1_ID,
          durationDays: 10,
          guestCount: 2,
          currency: "CAD",
          holdExpiresAt: "2099-04-21T00:00:00.000Z",
        }),
      );
      expect(summary.payment).toBeNull();
      expect(summary.paypal).toEqual({
        clientId: "paypal-test-client-id",
        environment: "sandbox",
        enabledMethods: expect.arrayContaining(["paypal", "card"]),
      });
    });

    it("reports the stored amounts of an existing payment", async () => {
      const { service } = createService({
        repository: {
          findCheckoutContext: jest.fn(async () =>
            createCheckoutContext({
              payment: createPaymentRecord({
                status: "processing",
                rentalSubtotalAmount: 250,
                platformFeeAmount: 25,
                totalAmount: 275,
                attempts: [
                  {
                    id: ATTEMPT_1_ID,
                    providerOrderId: "order-old",
                    paymentMethod: "paypal",
                  },
                  {
                    id: ATTEMPT_1_ID,
                    providerOrderId: "order-1",
                    paymentMethod: "card",
                  },
                ],
              }),
            }),
          ),
        },
      });

      const summary = await service.getCheckoutSummary(
        BOOKING_1_ID,
        RENTER_1_ID,
      );

      expect(summary.pricing.source).toBe("payment");
      expect(summary.pricing.depositBps).toBe(2500);
      expect(summary.payment).toEqual({
        id: PAYMENT_1_ID,
        status: "processing",
        providerOrderId: "order-1",
        method: "card",
      });
    });

    it("hides percentages when stored amounts predate the current formula", async () => {
      const { service } = createService({
        repository: {
          findCheckoutContext: jest.fn(async () =>
            createCheckoutContext({
              payment: createPaymentRecord({
                status: "failed_final",
                rentalSubtotalAmount: 1000,
                platformFeeAmount: 120,
                totalAmount: 1120,
              }),
            }),
          ),
        },
      });

      const summary = await service.getCheckoutSummary(
        BOOKING_1_ID,
        RENTER_1_ID,
      );

      expect(summary.pricing).toEqual(
        expect.objectContaining({
          depositAmount: 1000,
          totalDueNow: 1120,
          remainingBalance: 0,
          depositBps: null,
          platformFeeBps: null,
        }),
      );
    });

    it.each([
      [{ booking: { converted: true, status: "paid" } }, "converted"],
      [{ booking: { status: "paid" } }, "already_paid"],
      [
        { payment: createPaymentRecord({ status: "succeeded" }) },
        "already_paid",
      ],
      [{ booking: { paymentReconciliationRequired: true } }, "reconciliation"],
      [{ booking: { status: "expired" } }, "hold_expired"],
      [{ booking: { status: "cancelled" } }, "not_payable"],
      [
        { booking: { holdExpiresAt: new Date("2020-01-01T00:00:00.000Z") } },
        "hold_expired",
      ],
    ])("marks checkout ineligible (%j -> %s)", async (overrides, reason) => {
      const { service } = createService({
        repository: {
          findCheckoutContext: jest.fn(async () =>
            createCheckoutContext(overrides),
          ),
        },
      });

      const summary = await service.getCheckoutSummary(
        BOOKING_1_ID,
        RENTER_1_ID,
      );

      expect(summary.checkout).toEqual({ eligible: false, reason });
    });

    it("allows checkout to continue while an order is open", async () => {
      const { service } = createService({
        repository: {
          findCheckoutContext: jest.fn(async () =>
            createCheckoutContext({
              booking: { status: "payment_processing" },
              payment: createPaymentRecord({ status: "processing" }),
            }),
          ),
        },
      });

      const summary = await service.getCheckoutSummary(
        BOOKING_1_ID,
        RENTER_1_ID,
      );

      expect(summary.checkout).toEqual({ eligible: true });
    });

    it("returns 404 for unknown bookings and 403 for anyone but the renter", async () => {
      const missing = createService({
        repository: {
          findCheckoutContext: jest.fn(async () => null),
        },
      });

      await expect(
        missing.service.getCheckoutSummary(BOOKING_MISSING_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);

      const { service } = createService();

      await expect(
        service.getCheckoutSummary(BOOKING_1_ID, OWNER_1_ID),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
