import ConflictError from "@/errors/http/conflict.error";
import type { CacheService } from "@/features/cache/cache.service";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import { PaymentsService } from "@/features/payments/payments.service";
import { PaymentsRepository } from "@/features/payments/payments.repository";

function createPaymentRecord() {
  return {
    id: "payment-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    provider: "square" as const,
    status: "succeeded" as const,
    pricingCurrency: "CAD",
    rentalSubtotalAmount: 100,
    platformFeeAmount: 10,
    totalAmount: 110,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    booking: {
      id: "booking-1",
      status: "awaiting_payment",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
      paymentReconciliationRequired: true,
    },
    attempts: [],
    refunds: [],
  };
}

describe("PaymentsService", () => {
  it("throws ConflictError on reconcile when payment success needs reconciliation", async () => {
    const payment = createPaymentRecord();
    const paymentsRepository = {
      findAccessibleById: jest.fn(async () => payment),
      markPaymentSucceeded: jest.fn(async () => ({
        payment,
        reconciliationRequired: true,
      })),
    } as unknown as PaymentsRepository;
    const paymentProvider = {
      getPaymentStatus: jest.fn(async () => ({
        providerPaymentId: "square-pay-1",
        providerOrderId: "square-order-1",
        status: "COMPLETED",
        raw: {},
      })),
    } as unknown as PaymentProviderAdapter;
    const analyticsRepository = {
      enqueuePaymentFailedEvent: jest.fn(async () => undefined),
      enqueueRefundRecordedEvent: jest.fn(async () => undefined),
    } as unknown as PostingsAnalyticsRepository;
    const postingsRepository = {
      enqueueSearchSync: jest.fn(async () => undefined),
    } as unknown as PostingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;

    const service = new PaymentsService(
      paymentsRepository,
      paymentProvider,
      analyticsRepository,
      postingsRepository,
      cacheService,
      postingsPublicCacheService,
    );

    await expect(
      service.reconcilePayment("payment-1", "renter-1"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      (cacheService.acquireLock as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toBe("posting:posting-1:booking-window");
    expect(
      postingsPublicCacheService.invalidatePublic as unknown as jest.Mock,
    ).toHaveBeenCalledWith("posting-1");
  });

  it("does not throw from webhook processing when payment success needs reconciliation", async () => {
    const payment = createPaymentRecord();
    const paymentsRepository = {
      findBySquareReferences: jest.fn(async () => payment),
      upsertWebhookEvent: jest.fn(async () => ({
        alreadyProcessed: false,
      })),
      markPaymentSucceeded: jest.fn(async () => ({
        payment,
        reconciliationRequired: true,
      })),
      markWebhookProcessed: jest.fn(async () => undefined),
    } as unknown as PaymentsRepository;
    const paymentProvider = {
      verifyWebhookSignature: jest.fn(() => ({
        payload: {
          data: {
            object: {
              payment: {
                id: "square-pay-1",
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
    } as unknown as PaymentProviderAdapter;
    const analyticsRepository = {
      enqueuePaymentFailedEvent: jest.fn(async () => undefined),
      enqueueRefundRecordedEvent: jest.fn(async () => undefined),
    } as unknown as PostingsAnalyticsRepository;
    const postingsRepository = {
      enqueueSearchSync: jest.fn(async () => undefined),
    } as unknown as PostingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;

    const service = new PaymentsService(
      paymentsRepository,
      paymentProvider,
      analyticsRepository,
      postingsRepository,
      cacheService,
      postingsPublicCacheService,
    );

    await expect(
      service.processSquareWebhook("{}", "sig"),
    ).resolves.toBeUndefined();
    expect(
      paymentsRepository.markWebhookProcessed as unknown as jest.Mock,
    ).toHaveBeenCalledWith("event-1");
    expect(
      postingsPublicCacheService.invalidatePublic as unknown as jest.Mock,
    ).toHaveBeenCalledWith("posting-1");
  });
});
