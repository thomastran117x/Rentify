import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingsService } from "@/features/bookings/bookings.service";
import type { CacheService } from "@/features/cache/cache.service";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import type { PaymentsRepository } from "@/features/payments/payments.repository";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingRecord } from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";

function createPostingRecord(overrides: Partial<PostingRecord> = {}): PostingRecord {
  return {
    id: "posting-1",
    ownerId: "owner-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "City loft",
    description: "A bright loft.",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    pricingCurrency: "CAD",
    photos: [],
    tags: [],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: [],
    },
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      latitude: 43.65,
      longitude: -79.38,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function createBookingRequestRecord(overrides: Partial<BookingRequestRecord> = {}): BookingRequestRecord {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    status: "pending",
    startAt: "2026-05-01T00:00:00.000Z",
    endAt: "2026-05-04T00:00:00.000Z",
    durationDays: 3,
    guestCount: 2,
    contactName: "Jordan Lee",
    contactEmail: "jordan@example.com",
    contactPhoneNumber: "+1 416 555 0100",
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: 120,
    estimatedTotal: 360,
    holdExpiresAt: "2026-04-21T00:00:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "City loft",
      effectiveMaxBookingDurationDays: 30,
    },
    ...overrides,
  };
}

function createRentingRecord(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: "renting-1",
    postingId: "posting-1",
    bookingRequestId: "booking-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    status: "confirmed",
    startAt: "2099-05-01T00:00:00.000Z",
    endAt: "2099-05-04T00:00:00.000Z",
    durationDays: 3,
    guestCount: 2,
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: 120,
    estimatedTotal: 360,
    confirmedAt: "2099-04-23T00:00:00.000Z",
    createdAt: "2099-04-23T00:00:00.000Z",
    updatedAt: "2099-04-23T00:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "City loft",
      primaryPhotoUrl: "https://example.test/loft.jpg",
    },
    ...overrides,
  };
}

function createPaymentRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "payment-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    provider: "square",
    status: "succeeded",
    pricingCurrency: "CAD",
    rentalSubtotalAmount: 300,
    platformFeeAmount: 30,
    totalAmount: 330,
    booking: {
      id: "booking-1",
      status: "paid",
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
      paymentReconciliationRequired: false,
    },
    attempts: [],
    refunds: [],
    ...overrides,
  };
}

function createService(options?: {
  activeRequestCount?: number;
  availabilityOverlap?: boolean;
  createdBooking?: BookingRequestRecord;
  dashboardBookings?: BookingRequestRecord[];
  dashboardOwnerBookings?: BookingRequestRecord[];
  dashboardOwnerPostingOptions?: Array<{ id: string; name: string }>;
  dashboardRentings?: Array<ReturnType<typeof createRentingRecord>>;
  posting?: PostingRecord;
  paymentRecord?: ReturnType<typeof createPaymentRecord> | null;
  rentingOverlap?: boolean;
}) {
  const posting = options?.posting ?? createPostingRecord();
  const createdBooking = options?.createdBooking ?? createBookingRequestRecord();

  const bookingsRepository = {
    countActiveRequestsForRenterPosting: jest.fn(
      async () => options?.activeRequestCount ?? 0,
    ),
    createIfWithinActiveRequestLimit: jest.fn(async () => createdBooking),
    findById: jest.fn(async () => createdBooking),
    updatePending: jest.fn(async () => createdBooking),
    approve: jest.fn(async () => ({
      ...createdBooking,
      status: "awaiting_payment",
    })),
    decline: jest.fn(async () => ({
      ...createdBooking,
      status: "declined",
    })),
    listByOwner: jest.fn(async () => ({
      bookingRequests: [createdBooking],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    listDashboardByRenter: jest.fn(async () => options?.dashboardBookings ?? [createdBooking]),
    listDashboardByOwner: jest.fn(
      async () => options?.dashboardOwnerBookings ?? options?.dashboardBookings ?? [createdBooking],
    ),
    listDashboardPostingOptionsByOwner: jest.fn(
      async () => options?.dashboardOwnerPostingOptions ?? [{ id: "posting-1", name: "City loft" }],
    ),
    cancel: jest.fn(async () => ({
      ...createdBooking,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    })),
    hasBlockingAvailabilityOverlap: jest.fn(async () => options?.availabilityOverlap ?? false),
  } as unknown as BookingsRepository;

  const postingsRepository = {
    findById: jest.fn(async () => posting),
    enqueueSearchSync: jest.fn(async () => undefined),
  } as unknown as PostingsRepository;

  const analyticsRepository = {
    enqueueBookingRequestedEvent: jest.fn(async () => undefined),
    enqueueBookingApprovedEvent: jest.fn(async () => undefined),
    enqueueBookingDeclinedEvent: jest.fn(async () => undefined),
    enqueueBookingCancelledEvent: jest.fn(async () => undefined),
  } as unknown as PostingsAnalyticsRepository;

  const rentingsRepository = {
    hasOverlap: jest.fn(async () => options?.rentingOverlap ?? false),
    listByRenterForDashboard: jest.fn(async () => options?.dashboardRentings ?? []),
    listByOwnerForDashboard: jest.fn(async () => options?.dashboardRentings ?? []),
  } as unknown as RentingsRepository;
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
  const paymentsRepository = {
    findByBookingRequestId: jest.fn(async () => options?.paymentRecord ?? createPaymentRecord()),
    createRefundRecord: jest.fn(async () => ({
      refundId: "refund-1",
      paymentId: "payment-1",
      providerPaymentId: "square-pay-1",
      pricingCurrency: "CAD",
    })),
    completeRefund: jest.fn(async () => createPaymentRecord()),
  } as unknown as PaymentsRepository;
  const paymentProvider = {
    createRefund: jest.fn(async () => ({
      providerRefundId: "square-refund-1",
      status: "COMPLETED",
      raw: { ok: true },
    })),
    classifyError: jest.fn(() => ({
      category: "transient",
      code: "provider-error",
      message: "Provider temporarily unavailable.",
      retryable: true,
    })),
  } as unknown as PaymentProviderAdapter;

  const service = new BookingsService(
    bookingsRepository,
    postingsRepository,
    analyticsRepository,
    rentingsRepository,
    cacheService,
    postingsPublicCacheService,
    paymentsRepository,
    paymentProvider,
  );

  return {
    service,
    bookingsRepository: bookingsRepository as unknown as {
      countActiveRequestsForRenterPosting: jest.Mock;
      createIfWithinActiveRequestLimit: jest.Mock;
      findById: jest.Mock;
      updatePending: jest.Mock;
      approve: jest.Mock;
      decline: jest.Mock;
      listByOwner: jest.Mock;
      listDashboardByRenter: jest.Mock;
      listDashboardByOwner: jest.Mock;
      listDashboardPostingOptionsByOwner: jest.Mock;
      cancel: jest.Mock;
      hasBlockingAvailabilityOverlap: jest.Mock;
    },
    analyticsRepository: analyticsRepository as unknown as {
      enqueueBookingRequestedEvent: jest.Mock;
      enqueueBookingApprovedEvent: jest.Mock;
      enqueueBookingDeclinedEvent: jest.Mock;
      enqueueBookingCancelledEvent: jest.Mock;
    },
    postingsRepository: postingsRepository as unknown as {
      findById: jest.Mock;
      enqueueSearchSync: jest.Mock;
    },
    rentingsRepository: rentingsRepository as unknown as {
      hasOverlap: jest.Mock;
      listByRenterForDashboard: jest.Mock;
      listByOwnerForDashboard: jest.Mock;
    },
    cacheService: cacheService as unknown as {
      acquireLock: jest.Mock;
    },
    postingsPublicCacheService: postingsPublicCacheService as unknown as {
      invalidatePublic: jest.Mock;
    },
    paymentsRepository: paymentsRepository as unknown as {
      findByBookingRequestId: jest.Mock;
      createRefundRecord: jest.Mock;
      completeRefund: jest.Mock;
    },
    paymentProvider: paymentProvider as unknown as {
      createRefund: jest.Mock;
      classifyError: jest.Mock;
    },
  };
}

describe("BookingsService", () => {
  it("allows overlapping booking requests before payment when the posting is otherwise available", async () => {
    const {
      service,
      bookingsRepository,
      analyticsRepository,
      postingsRepository,
      postingsPublicCacheService,
    } = createService();

    const result = await service.create({
      postingId: "posting-1",
      renterId: "renter-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      contactPhoneNumber: "+1 416 555 0100",
      note: "Can arrive after 5pm",
    });

    expect(bookingsRepository.countActiveRequestsForRenterPosting).toHaveBeenCalledWith({
      postingId: "posting-1",
      renterId: "renter-1",
      excludeBookingRequestId: undefined,
    });
    expect(bookingsRepository.countActiveRequestsForRenterPosting).toHaveBeenCalledTimes(2);
    expect(bookingsRepository.createIfWithinActiveRequestLimit).toHaveBeenCalledTimes(1);
    expect(analyticsRepository.enqueueBookingRequestedEvent).toHaveBeenCalledTimes(1);
    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith("posting-1");
    expect(postingsRepository.enqueueSearchSync).toHaveBeenCalledWith("posting-1");
    expect(result.id).toBe("booking-1");
  });

  it("serializes booking creation on the posting booking-window lock before the renter cap lock", async () => {
    const { service, cacheService } = createService();

    await service.create({
      postingId: "posting-1",
      renterId: "renter-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
    });

    expect(cacheService.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      "posting:posting-1:booking-window",
      "booking-request-cap:posting-1:renter-1",
    ]);
  });

  it("rejects creating a third active booking request for the same posting", async () => {
    const { service } = createService({
      activeRequestCount: 2,
    });

    await expect(
      service.create({
        postingId: "posting-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
        contactPhoneNumber: "+1 416 555 0100",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message:
        "You can only keep 2 active booking requests for this posting at a time. Please update or complete an existing request before creating another.",
    });
  });

  it("returns a bookable quote using the same pricing and duration calculation as booking creation", async () => {
    const { service, bookingsRepository, rentingsRepository } = createService();

    const result = await service.quote({
      postingId: "posting-1",
      renterId: "renter-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      guestCount: 2,
    });

    expect(result).toMatchObject({
      postingId: "posting-1",
      bookable: true,
      durationDays: 3,
      pricingCurrency: "CAD",
      dailyPriceAmount: 120,
      estimatedTotal: 360,
      maxBookingDurationDays: 30,
      failureReasons: [],
    });
    expect(rentingsRepository.hasOverlap).toHaveBeenCalledTimes(1);
    expect(bookingsRepository.hasBlockingAvailabilityOverlap).toHaveBeenCalledTimes(1);
    expect(bookingsRepository.countActiveRequestsForRenterPosting).toHaveBeenCalledTimes(1);
  });

  it("returns quote failure reasons from heavyweight booking validation", async () => {
    const { service } = createService({
      activeRequestCount: 2,
      availabilityOverlap: true,
      rentingOverlap: true,
      posting: createPostingRecord({
        maxBookingDurationDays: 2,
        effectiveMaxBookingDurationDays: 2,
      }),
    });

    const result = await service.quote({
      postingId: "posting-1",
      renterId: "renter-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      guestCount: 2,
    });

    expect(result.bookable).toBe(false);
    expect(result.durationDays).toBe(3);
    expect(result.estimatedTotal).toBe(360);
    expect(result.failureReasons.map((reason) => reason.code)).toEqual([
      "max_duration_exceeded",
      "renting_overlap",
      "availability_block_overlap",
      "active_request_limit_exceeded",
    ]);
  });

  it("rejects new booking demand for paused postings", async () => {
    const { service, bookingsRepository } = createService({
      posting: createPostingRecord({
        status: "paused",
        pausedAt: "2026-04-23T00:00:00.000Z",
      }),
    });

    const quote = await service.quote({
      postingId: "posting-1",
      renterId: "renter-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      guestCount: 2,
    });

    expect(quote.bookable).toBe(false);
    expect(quote.failureReasons.map((reason) => reason.code)).toContain("posting_unavailable");

    await expect(
      service.create({
        postingId: "posting-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking requests are only allowed for published postings.",
    });

    expect(bookingsRepository.createIfWithinActiveRequestLimit).not.toHaveBeenCalled();
  });

  it("re-checks posting status under the posting lock so pause wins a new booking race", async () => {
    const publishedPosting = createPostingRecord({
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    });
    const pausedPosting = createPostingRecord({
      status: "paused",
      publishedAt: "2026-04-21T00:00:00.000Z",
      pausedAt: "2026-04-23T00:00:00.000Z",
    });
    const { service, postingsRepository, bookingsRepository } = createService({
      posting: publishedPosting,
    });
    postingsRepository.findById
      .mockResolvedValueOnce(publishedPosting)
      .mockResolvedValueOnce(pausedPosting);

    await expect(
      service.create({
        postingId: "posting-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking requests are only allowed for published postings.",
    });

    expect(bookingsRepository.createIfWithinActiveRequestLimit).not.toHaveBeenCalled();
  });

  it("runs heavyweight validation before rejecting booking creation", async () => {
    const { service, bookingsRepository, rentingsRepository } = createService({
      posting: createPostingRecord({
        maxBookingDurationDays: 2,
        effectiveMaxBookingDurationDays: 2,
      }),
    });

    await expect(
      service.create({
        postingId: "posting-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking duration cannot exceed 2 days.",
    });

    expect(rentingsRepository.hasOverlap).toHaveBeenCalledTimes(1);
    expect(bookingsRepository.hasBlockingAvailabilityOverlap).toHaveBeenCalledTimes(1);
    expect(bookingsRepository.countActiveRequestsForRenterPosting).toHaveBeenCalledTimes(1);
    expect(bookingsRepository.createIfWithinActiveRequestLimit).not.toHaveBeenCalled();
  });

  it("persists booking contact info as part of the request snapshot", async () => {
    const { service, bookingsRepository } = createService();

    await service.create({
      postingId: "posting-1",
      renterId: "renter-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "Jordan@example.com",
      contactPhoneNumber: "  +1 416 555 0100  ",
      note: null,
    });

    expect(bookingsRepository.createIfWithinActiveRequestLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
        contactPhoneNumber: "+1 416 555 0100",
      }),
      2,
    );
  });

  it("returns a conflict when the booking-request cap lock is busy", async () => {
    const { service, cacheService, bookingsRepository } = createService();
    cacheService.acquireLock.mockResolvedValueOnce(null);

    await expect(
      service.create({
        postingId: "posting-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(bookingsRepository.createIfWithinActiveRequestLimit).not.toHaveBeenCalled();
  });

  it("returns a conflict when a pending update loses its conditional write", async () => {
    const booking = createBookingRequestRecord({
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
    });
    const { service, bookingsRepository, cacheService } = createService({
      createdBooking: booking,
    });
    bookingsRepository.findById.mockResolvedValue(booking);
    bookingsRepository.updatePending.mockResolvedValue(null);

    await expect(
      service.updateOwnPending({
        bookingRequestId: "booking-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(cacheService.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      "booking-request:booking-1:state",
      "posting:posting-1:booking-window",
    ]);
  });

  it("blocks renter updates when the posting is paused", async () => {
    const booking = createBookingRequestRecord({
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
    });
    const { service, bookingsRepository, postingsRepository } = createService({
      createdBooking: booking,
      posting: createPostingRecord({
        status: "paused",
        pausedAt: "2026-04-23T00:00:00.000Z",
      }),
    });
    bookingsRepository.findById.mockResolvedValue(booking);

    await expect(
      service.updateOwnPending({
        bookingRequestId: "booking-1",
        renterId: "renter-1",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Pending booking requests cannot be updated for this posting.",
    });

    expect(postingsRepository.findById).toHaveBeenCalled();
  });

  it("serializes approve with decision, state, and posting locks", async () => {
    const booking = createBookingRequestRecord({
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
    });
    const { service, cacheService, postingsPublicCacheService, analyticsRepository } = createService({
      createdBooking: booking,
    });

    await service.approve({
      bookingRequestId: "booking-1",
      ownerId: "owner-1",
      note: "approved",
    });

    expect(cacheService.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      "booking-request:booking-1:decision",
      "booking-request:booking-1:state",
      "posting:posting-1:booking-window",
    ]);
    expect(analyticsRepository.enqueueBookingApprovedEvent).toHaveBeenCalledTimes(1);
    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith("posting-1");
  });

  it("allows owners to approve existing requests while the posting is paused", async () => {
    const booking = createBookingRequestRecord({
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
    });
    const { service, bookingsRepository, analyticsRepository } = createService({
      createdBooking: booking,
      posting: createPostingRecord({
        status: "paused",
        pausedAt: "2026-04-23T00:00:00.000Z",
      }),
    });

    const approved = await service.approve({
      bookingRequestId: "booking-1",
      ownerId: "owner-1",
      note: "approved",
    });

    expect(bookingsRepository.approve).toHaveBeenCalledTimes(1);
    expect(analyticsRepository.enqueueBookingApprovedEvent).toHaveBeenCalledTimes(1);
    expect(approved.status).toBe("awaiting_payment");
  });

  it("lists owned booking requests for account management", async () => {
    const { service, bookingsRepository } = createService();

    const result = await service.listOwned({
      ownerId: "owner-1",
      page: 1,
      pageSize: 20,
    });

    expect(bookingsRepository.listByOwner).toHaveBeenCalledWith({
      ownerId: "owner-1",
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(result.bookingRequests).toHaveLength(1);
  });

  it("builds a renter dashboard with action-needed, upcoming, past, and cancelled buckets", async () => {
    const pending = createBookingRequestRecord({
      id: "booking-pending",
      status: "pending",
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-03T00:00:00.000Z",
    });
    const awaitingPayment = createBookingRequestRecord({
      id: "booking-awaiting",
      status: "awaiting_payment",
      holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      startAt: "2099-05-04T00:00:00.000Z",
      endAt: "2099-05-06T00:00:00.000Z",
    });
    const cancelled = createBookingRequestRecord({
      id: "booking-cancelled",
      status: "cancelled",
      startAt: "2099-05-07T00:00:00.000Z",
      endAt: "2099-05-08T00:00:00.000Z",
    });
    const paidConverted = createBookingRequestRecord({
      id: "booking-paid-converted",
      status: "paid",
      convertedAt: "2099-04-21T00:00:00.000Z",
      rentingId: "renting-1",
    });
    const futureRenting = createRentingRecord({
      id: "renting-future",
      bookingRequestId: "booking-future",
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const activeRenting = createRentingRecord({
      id: "renting-active",
      bookingRequestId: "booking-active",
      status: "active",
      startAt: "2099-05-11T00:00:00.000Z",
      endAt: "2099-05-13T00:00:00.000Z",
    });
    const pastRenting = createRentingRecord({
      id: "renting-past",
      bookingRequestId: "booking-past",
      status: "completed",
      completedAt: "2026-04-12T00:00:00.000Z",
      startAt: "2026-04-10T00:00:00.000Z",
      endAt: "2026-04-12T00:00:00.000Z",
    });
    const { service, bookingsRepository, rentingsRepository } = createService({
      dashboardBookings: [pending, awaitingPayment, cancelled, paidConverted],
      dashboardRentings: [futureRenting, activeRenting, pastRenting],
    });

    const result = await service.dashboardMine({
      renterId: "renter-1",
      page: 1,
      pageSize: 10,
      sort: "urgency",
    });

    expect(bookingsRepository.listDashboardByRenter).toHaveBeenCalledWith({
      renterId: "renter-1",
      status: undefined,
    });
    expect(rentingsRepository.listByRenterForDashboard).toHaveBeenCalledWith("renter-1");
    expect(result.summary).toEqual({
      upcoming: 1,
      active: 1,
      pending: 1,
      actionNeeded: 1,
      past: 1,
      cancelled: 1,
    });
    expect(result.items.find((item) => item.id === "booking-awaiting")).toMatchObject({
      kind: "booking_request",
      id: "booking-awaiting",
      actionNeededCategory: "payment",
      isExpiringHold: true,
    });
    expect(result.items.some((item) => item.id === "booking-paid-converted")).toBe(false);
  });

  it("filters renter dashboards by status before merging rentings", async () => {
    const awaitingPayment = createBookingRequestRecord({
      id: "booking-awaiting",
      status: "awaiting_payment",
    });
    const { service, bookingsRepository, rentingsRepository } = createService({
      dashboardBookings: [awaitingPayment],
      dashboardRentings: [createRentingRecord()],
    });

    const result = await service.dashboardMine({
      renterId: "renter-1",
      page: 1,
      pageSize: 10,
      sort: "urgency",
      status: "awaiting_payment",
      bucket: "action_needed",
    });

    expect(bookingsRepository.listDashboardByRenter).toHaveBeenCalledWith({
      renterId: "renter-1",
      status: "awaiting_payment",
    });
    expect(rentingsRepository.listByRenterForDashboard).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("booking-awaiting");
  });

  it("builds owner dashboards with cross-posting scoping and action-needed filters", async () => {
    const pending = createBookingRequestRecord({
      id: "booking-pending",
      postingId: "posting-1",
      posting: {
        id: "posting-1",
        name: "City loft",
        effectiveMaxBookingDurationDays: 30,
      },
      status: "pending",
      holdExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    const paymentFailed = createBookingRequestRecord({
      id: "booking-failed",
      postingId: "posting-2",
      posting: {
        id: "posting-2",
        name: "Studio set",
        effectiveMaxBookingDurationDays: 30,
      },
      status: "payment_failed",
      holdExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    const converted = createBookingRequestRecord({
      id: "booking-converted",
      postingId: "posting-3",
      status: "paid",
      convertedAt: "2099-04-21T00:00:00.000Z",
      rentingId: "renting-3",
    });
    const readyToConvert = createBookingRequestRecord({
      id: "booking-convert",
      postingId: "posting-4",
      posting: {
        id: "posting-4",
        name: "Canal cottage",
        effectiveMaxBookingDurationDays: 30,
      },
      status: "paid",
      holdExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });
    const ownerUpcomingRenting = createRentingRecord({
      id: "renting-upcoming",
      bookingRequestId: "booking-renting-upcoming",
      status: "confirmed",
    });
    const ownerActiveRenting = createRentingRecord({
      id: "renting-active",
      bookingRequestId: "booking-renting-active",
      status: "active",
    });
    const ownerPastRenting = createRentingRecord({
      id: "renting-past",
      bookingRequestId: "booking-renting-past",
      status: "completed",
      completedAt: "2026-04-12T00:00:00.000Z",
      startAt: "2026-04-10T00:00:00.000Z",
      endAt: "2026-04-12T00:00:00.000Z",
    });
    const { service, bookingsRepository } = createService({
      dashboardOwnerBookings: [pending, paymentFailed, converted, readyToConvert],
      dashboardRentings: [ownerUpcomingRenting, ownerActiveRenting, ownerPastRenting],
      dashboardOwnerPostingOptions: [
        { id: "posting-1", name: "City loft" },
        { id: "posting-2", name: "Studio set" },
        { id: "posting-4", name: "Canal cottage" },
      ],
    });

    const result = await service.dashboardOwned({
      ownerId: "owner-1",
      page: 1,
      pageSize: 10,
      sort: "urgency",
      actionNeeded: "conversion",
    });

    expect(bookingsRepository.listDashboardByOwner).toHaveBeenCalledWith({
      ownerId: "owner-1",
      status: undefined,
      postingId: undefined,
    });
    expect(result.summary).toEqual({
      approval: 1,
      payment: 0,
      expiringHold: 1,
      paymentFailure: 1,
      conversion: 1,
      upcomingRentings: 1,
      activeRentings: 1,
      pastRentings: 1,
      totalOpen: 3,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "booking-convert",
      actionNeededCategory: "conversion",
    });
    expect(result.postings).toEqual([
      { id: "posting-1", name: "City loft" },
      { id: "posting-2", name: "Studio set" },
      { id: "posting-4", name: "Canal cottage" },
    ]);
  });

  it("quotes full paid refunds for renter cancellations more than 48 hours before start", async () => {
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "paid",
        startAt: "2099-05-10T00:00:00.000Z",
        endAt: "2099-05-12T00:00:00.000Z",
      }),
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");

    expect(quote).toMatchObject({
      cancellable: true,
      actor: "renter",
      refundType: "full",
      refundAmount: 330,
      currency: "CAD",
    });
  });

  it("quotes partial paid refunds for renter cancellations between 24 and 48 hours before start", async () => {
    const startAt = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 60 * 60 * 1000 + 36 * 60 * 60 * 1000).toISOString();
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "paid",
        startAt,
        endAt,
      }),
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");

    expect(quote).toMatchObject({
      cancellable: true,
      refundType: "partial",
      refundAmount: 165,
    });
  });

  it("quotes no refund for renter paid cancellations inside 24 hours of start", async () => {
    const startAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "paid",
        startAt,
        endAt,
      }),
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");

    expect(quote).toMatchObject({
      cancellable: true,
      refundType: "none",
      refundAmount: 0,
    });
  });

  it("requires owner reasons and forces full refunds on paid owner cancellations", async () => {
    const booking = createBookingRequestRecord({
      status: "paid",
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const { service, bookingsRepository, paymentsRepository, paymentProvider, analyticsRepository } =
      createService({
        createdBooking: booking,
      });

    await expect(
      service.cancel({
        bookingRequestId: "booking-1",
        actorUserId: "owner-1",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Owners must provide a cancellation reason.",
    });

    const cancelled = await service.cancel({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
      reason: "Pipe burst in the unit.",
    });

    expect(paymentsRepository.createRefundRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "payment-1",
        actorUserId: "owner-1",
        amount: 330,
        reason: "Pipe burst in the unit.",
        idempotencyKey: "booking-cancel-booking-1",
      }),
    );
    expect(paymentProvider.createRefund).toHaveBeenCalledTimes(1);
    expect(bookingsRepository.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "owner",
        expectedStatus: "paid",
        cancellationRefundAmount: 330,
      }),
    );
    expect(analyticsRepository.enqueueBookingCancelledEvent).toHaveBeenCalledTimes(1);
    expect(cancelled.status).toBe("cancelled");
  });

  it("allows renters to cancel unpaid bookings without creating refunds", async () => {
    const booking = createBookingRequestRecord({
      status: "awaiting_payment",
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const { service, bookingsRepository, paymentsRepository, paymentProvider } = createService({
      createdBooking: booking,
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");
    expect(quote).toMatchObject({
      cancellable: true,
      actor: "renter",
      refundType: "none",
      refundAmount: 0,
    });

    await service.cancel({
      bookingRequestId: "booking-1",
      actorUserId: "renter-1",
      reason: "Schedule conflict",
    });

    expect(bookingsRepository.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "renter",
        expectedStatus: "awaiting_payment",
        cancellationRefundAmount: 0,
      }),
    );
    expect(paymentsRepository.createRefundRecord).not.toHaveBeenCalled();
    expect(paymentProvider.createRefund).not.toHaveBeenCalled();
  });

  it("rejects cancellations for converted bookings", async () => {
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "paid",
        startAt: "2099-05-10T00:00:00.000Z",
        endAt: "2099-05-12T00:00:00.000Z",
        convertedAt: "2099-04-21T00:00:00.000Z",
        rentingId: "renting-1",
      }),
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");
    expect(quote.cancellable).toBe(false);
    expect(quote.failureReasons[0]?.code).toBe("booking_already_converted");

    await expect(
      service.cancel({
        bookingRequestId: "booking-1",
        actorUserId: "renter-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects cancellations for already-terminal booking statuses", async () => {
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "declined",
        startAt: "2099-05-10T00:00:00.000Z",
        endAt: "2099-05-12T00:00:00.000Z",
      }),
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");
    expect(quote.cancellable).toBe(false);
    expect(quote.failureReasons[0]?.code).toBe("booking_status_ineligible");
  });

  it("rejects payment-processing self-service cancellations with a conflict", async () => {
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "payment_processing",
        startAt: "2099-05-10T00:00:00.000Z",
        endAt: "2099-05-12T00:00:00.000Z",
      }),
    });

    const quote = await service.getCancellationQuote("booking-1", "renter-1");
    expect(quote.cancellable).toBe(false);
    expect(quote.failureReasons[0]?.code).toBe("payment_processing_in_progress");

    await expect(
      service.cancel({
        bookingRequestId: "booking-1",
        actorUserId: "renter-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
