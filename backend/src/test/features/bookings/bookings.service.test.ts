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
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import { testUuid } from "../../support/uuid";
const BOOKING_ACTIVE_ID = testUuid(9200, 483432);
const BOOKING_FUTURE_ID = testUuid(9200, 266693);
const BOOKING_PAST_ID = testUuid(9200, 747186);
const BOOKING_RENTING_ACTIVE_ID = testUuid(9200, 512436);
const BOOKING_RENTING_PAST_ID = testUuid(9200, 288327);
const BOOKING_RENTING_UPCOMING_ID = testUuid(9200, 416636);
const ORG_1_ID = testUuid(9200, 9234);
const PAYMENT_1_ID = testUuid(9200, 132102);
const REFUND_1_ID = testUuid(9200, 376102);
const RENTING_ACTIVE_ID = testUuid(9200, 829415);
const RENTING_FUTURE_ID = testUuid(9200, 612676);
const RENTING_PAST_ID = testUuid(9200, 635165);
const RENTING_UPCOMING_ID = testUuid(9200, 38640);

const BOOKING_1_ID = testUuid(9000, 996753);
const BOOKING_AWAITING_ID = testUuid(9000, 946068);
const BOOKING_CANCELLED_ID = testUuid(9000, 802537);
const BOOKING_CONVERTED_ID = testUuid(9000, 97770);
const BOOKING_CONVERT_ID = testUuid(9000, 410081);
const BOOKING_FAILED_ID = testUuid(9000, 459196);
const BOOKING_PAID_CONVERTED_ID = testUuid(9000, 5039);
const BOOKING_PENDING_ID = testUuid(9000, 325160);
const OWNER_1_ID = testUuid(9000, 219201);
const POSTING_1_ID = testUuid(9000, 254272);
const POSTING_2_ID = testUuid(9000, 254273);
const POSTING_3_ID = testUuid(9000, 254274);
const POSTING_4_ID = testUuid(9000, 254275);
const RENTER_1_ID = testUuid(9000, 235000);
const RENTING_1_ID = testUuid(9000, 915753);
const RENTING_3_ID = testUuid(9000, 915755);

function createPostingRecord(overrides: Partial<PostingRecord> = {}): any {
  return {
    id: POSTING_1_ID,
    ownerId: OWNER_1_ID,
    organizationId: ORG_1_ID,
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

function createBookingRequestRecord(
  overrides: Partial<BookingRequestRecord> = {},
): any {
  return {
    id: BOOKING_1_ID,
    postingId: POSTING_1_ID,
    renterId: RENTER_1_ID,
    ownerId: OWNER_1_ID,
    organizationId: ORG_1_ID,
    status: "pending",
    startAt: "2099-05-01T00:00:00.000Z",
    endAt: "2099-05-04T00:00:00.000Z",
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
      id: POSTING_1_ID,
      name: "City loft",
      effectiveMaxBookingDurationDays: 30,
    },
    ...overrides,
  };
}

function createRentingRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RENTING_1_ID,
    postingId: POSTING_1_ID,
    bookingRequestId: BOOKING_1_ID,
    renterId: RENTER_1_ID,
    ownerId: OWNER_1_ID,
    organizationId: ORG_1_ID,
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
      id: POSTING_1_ID,
      name: "City loft",
      primaryPhotoUrl: "https://example.test/loft.jpg",
    },
    ...overrides,
  };
}

function createPaymentRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PAYMENT_1_ID,
    bookingRequestId: BOOKING_1_ID,
    postingId: POSTING_1_ID,
    renterId: RENTER_1_ID,
    ownerId: OWNER_1_ID,
    organizationId: ORG_1_ID,
    provider: "square",
    status: "succeeded",
    pricingCurrency: "CAD",
    rentalSubtotalAmount: 300,
    platformFeeAmount: 30,
    totalAmount: 330,
    booking: {
      id: BOOKING_1_ID,
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
  const createdBooking =
    options?.createdBooking ?? createBookingRequestRecord();

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
    listDashboardByRenter: jest.fn(
      async () => options?.dashboardBookings ?? [createdBooking],
    ),
    listDashboardByOwner: jest.fn(
      async () =>
        options?.dashboardOwnerBookings ??
        options?.dashboardBookings ?? [createdBooking],
    ),
    listDashboardPostingOptionsByOrganization: jest.fn(
      async () =>
        options?.dashboardOwnerPostingOptions ?? [
          { id: POSTING_1_ID, name: "City loft" },
        ],
    ),
    cancel: jest.fn(async () => ({
      ...createdBooking,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    })),
    hasBlockingAvailabilityOverlap: jest.fn(
      async () => options?.availabilityOverlap ?? false,
    ),
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
    listByRenterForDashboard: jest.fn(
      async () => options?.dashboardRentings ?? [],
    ),
    listByOwnerForDashboard: jest.fn(
      async () => options?.dashboardRentings ?? [],
    ),
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
    findByBookingRequestId: jest.fn(
      async () => options?.paymentRecord ?? createPaymentRecord(),
    ),
    createRefundRecord: jest.fn(async () => ({
      refundId: REFUND_1_ID,
      paymentId: PAYMENT_1_ID,
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
  const organizationAccessService = {
    requireActiveMembership: jest.fn(async (userId: string) => ({
      organizationId: ORG_1_ID,
      userId,
      role: "primary_manager",
    })),
    requireMembership: jest.fn(
      async (userId: string, organizationId: string) => {
        if (userId === OWNER_1_ID) {
          return {
            organizationId,
            userId,
            role: "primary_manager",
          };
        }

        throw new Error("Unexpected membership lookup");
      },
    ),
    findMembership: jest.fn(async (userId: string, organizationId: string) =>
      userId === OWNER_1_ID
        ? {
            organizationId,
            userId,
            role: "primary_manager",
          }
        : null,
    ),
    assertCanManage: jest.fn(() => undefined),
    canManage: jest.fn(
      (role: string) => role === "primary_manager" || role === "manager",
    ),
  } as unknown as OrganizationAccessService;

  const seasonalPricingRepository = {
    findOverlappingForBooking: jest.fn(async () => []),
  };

  const service = new BookingsService(
    bookingsRepository,
    postingsRepository,
    analyticsRepository,
    rentingsRepository,
    cacheService,
    postingsPublicCacheService,
    paymentsRepository,
    paymentProvider,
    organizationAccessService,
    seasonalPricingRepository as unknown as import("@/features/postings/seasonal-pricing/seasonal-pricing.repository").SeasonalPricingRepository,
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
      listDashboardPostingOptionsByOrganization: jest.Mock;
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
    organizationAccessService: organizationAccessService as unknown as {
      requireActiveMembership: jest.Mock;
      requireMembership: jest.Mock;
      findMembership: jest.Mock;
      assertCanManage: jest.Mock;
      canManage: jest.Mock;
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
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      contactPhoneNumber: "+1 416 555 0100",
      note: "Can arrive after 5pm",
    });

    expect(
      bookingsRepository.countActiveRequestsForRenterPosting,
    ).toHaveBeenCalledWith({
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      excludeBookingRequestId: undefined,
    });
    expect(
      bookingsRepository.countActiveRequestsForRenterPosting,
    ).toHaveBeenCalledTimes(2);
    expect(
      bookingsRepository.createIfWithinActiveRequestLimit,
    ).toHaveBeenCalledTimes(1);
    expect(
      analyticsRepository.enqueueBookingRequestedEvent,
    ).toHaveBeenCalledTimes(1);
    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith(
      POSTING_1_ID,
    );
    expect(postingsRepository.enqueueSearchSync).toHaveBeenCalledWith(
      POSTING_1_ID,
    );
    expect(result.id).toBe(BOOKING_1_ID);
  });

  it("serializes booking creation on the posting booking-window lock before the renter cap lock", async () => {
    const { service, cacheService } = createService();

    await service.create({
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
    });

    expect(cacheService.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      `posting:${POSTING_1_ID}:booking-window`,
      `booking-request-cap:${POSTING_1_ID}:${RENTER_1_ID}`,
    ]);
  });

  it("rejects creating a third active booking request for the same posting", async () => {
    const { service } = createService({
      activeRequestCount: 2,
    });

    await expect(
      service.create({
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
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
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      guestCount: 2,
    });

    expect(result).toMatchObject({
      postingId: POSTING_1_ID,
      bookable: true,
      durationDays: 3,
      pricingCurrency: "CAD",
      dailyPriceAmount: 120,
      estimatedTotal: 360,
      maxBookingDurationDays: 30,
      failureReasons: [],
    });
    expect(rentingsRepository.hasOverlap).toHaveBeenCalledTimes(1);
    expect(
      bookingsRepository.hasBlockingAvailabilityOverlap,
    ).toHaveBeenCalledTimes(1);
    expect(
      bookingsRepository.countActiveRequestsForRenterPosting,
    ).toHaveBeenCalledTimes(1);
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
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
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
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      guestCount: 2,
    });

    expect(quote.bookable).toBe(false);
    expect(quote.failureReasons.map((reason) => reason.code)).toContain(
      "posting_unavailable",
    );

    await expect(
      service.create({
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking requests are only allowed for published postings.",
    });

    expect(
      bookingsRepository.createIfWithinActiveRequestLimit,
    ).not.toHaveBeenCalled();
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
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking requests are only allowed for published postings.",
    });

    expect(
      bookingsRepository.createIfWithinActiveRequestLimit,
    ).not.toHaveBeenCalled();
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
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking duration cannot exceed 2 days.",
    });

    expect(rentingsRepository.hasOverlap).toHaveBeenCalledTimes(1);
    expect(
      bookingsRepository.hasBlockingAvailabilityOverlap,
    ).toHaveBeenCalledTimes(1);
    expect(
      bookingsRepository.countActiveRequestsForRenterPosting,
    ).toHaveBeenCalledTimes(1);
    expect(
      bookingsRepository.createIfWithinActiveRequestLimit,
    ).not.toHaveBeenCalled();
  });

  it("persists booking contact info as part of the request snapshot", async () => {
    const { service, bookingsRepository } = createService() as any;

    await service.create({
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-04T00:00:00.000Z",
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "Jordan@example.com",
      contactPhoneNumber: "  +1 416 555 0100  ",
      note: null,
    });

    expect(
      bookingsRepository.createIfWithinActiveRequestLimit,
    ).toHaveBeenCalledWith(
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
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(
      bookingsRepository.createIfWithinActiveRequestLimit,
    ).not.toHaveBeenCalled();
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
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(cacheService.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      `booking-request:${BOOKING_1_ID}:state`,
      `posting:${POSTING_1_ID}:booking-window`,
    ]);
  });

  it("blocks renter updates that move a pending request into the past", async () => {
    const booking = createBookingRequestRecord({
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
    });
    const { service, bookingsRepository } = createService({
      createdBooking: booking,
    });
    bookingsRepository.findById.mockResolvedValue(booking);

    // Dates are relative to the run date: the cutoff is today at 00:00 UTC.
    const pastStart = new Date();
    pastStart.setUTCHours(0, 0, 0, 0);
    pastStart.setUTCDate(pastStart.getUTCDate() - 3);
    const pastEnd = new Date(pastStart);
    pastEnd.setUTCDate(pastEnd.getUTCDate() + 2);

    await expect(
      service.updateOwnPending({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        startAt: pastStart.toISOString(),
        endAt: pastEnd.toISOString(),
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Booking start date cannot be in the past.",
    });

    expect(bookingsRepository.updatePending).not.toHaveBeenCalled();
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
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
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
    const {
      service,
      cacheService,
      postingsPublicCacheService,
      analyticsRepository,
    } = createService({
      createdBooking: booking,
    });

    await service.approve({
      bookingRequestId: BOOKING_1_ID,
      actorUserId: OWNER_1_ID,
      note: "approved",
    });

    expect(cacheService.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      `booking-request:${BOOKING_1_ID}:decision`,
      `booking-request:${BOOKING_1_ID}:state`,
      `posting:${POSTING_1_ID}:booking-window`,
    ]);
    expect(
      analyticsRepository.enqueueBookingApprovedEvent,
    ).toHaveBeenCalledTimes(1);
    expect(postingsPublicCacheService.invalidatePublic).toHaveBeenCalledWith(
      POSTING_1_ID,
    );
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
      bookingRequestId: BOOKING_1_ID,
      actorUserId: OWNER_1_ID,
      note: "approved",
    });

    expect(bookingsRepository.approve).toHaveBeenCalledTimes(1);
    expect(
      analyticsRepository.enqueueBookingApprovedEvent,
    ).toHaveBeenCalledTimes(1);
    expect(approved.status).toBe("awaiting_payment");
  });

  it("lists owned booking requests for account management", async () => {
    const { service, bookingsRepository } = createService() as any;

    const result = await service.listOwned({
      actorUserId: OWNER_1_ID,
      organizationId: ORG_1_ID,
      page: 1,
      pageSize: 20,
    });

    expect(bookingsRepository.listByOwner).toHaveBeenCalledWith({
      actorUserId: OWNER_1_ID,
      organizationId: ORG_1_ID,
      page: 1,
      pageSize: 20,
      status: undefined,
    });
    expect(result.bookingRequests).toHaveLength(1);
  });

  it("builds a renter dashboard with action-needed, upcoming, past, and cancelled buckets", async () => {
    const pending = createBookingRequestRecord({
      id: BOOKING_PENDING_ID,
      status: "pending",
      startAt: "2099-05-01T00:00:00.000Z",
      endAt: "2099-05-03T00:00:00.000Z",
    });
    const awaitingPayment = createBookingRequestRecord({
      id: BOOKING_AWAITING_ID,
      status: "awaiting_payment",
      holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      startAt: "2099-05-04T00:00:00.000Z",
      endAt: "2099-05-06T00:00:00.000Z",
    });
    const cancelled = createBookingRequestRecord({
      id: BOOKING_CANCELLED_ID,
      status: "cancelled",
      startAt: "2099-05-07T00:00:00.000Z",
      endAt: "2099-05-08T00:00:00.000Z",
    });
    const paidConverted = createBookingRequestRecord({
      id: BOOKING_PAID_CONVERTED_ID,
      status: "paid",
      convertedAt: "2099-04-21T00:00:00.000Z",
      rentingId: RENTING_1_ID,
    });
    const futureRenting = createRentingRecord({
      id: RENTING_FUTURE_ID,
      bookingRequestId: BOOKING_FUTURE_ID,
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const activeRenting = createRentingRecord({
      id: RENTING_ACTIVE_ID,
      bookingRequestId: BOOKING_ACTIVE_ID,
      status: "active",
      startAt: "2099-05-11T00:00:00.000Z",
      endAt: "2099-05-13T00:00:00.000Z",
    });
    const pastRenting = createRentingRecord({
      id: RENTING_PAST_ID,
      bookingRequestId: BOOKING_PAST_ID,
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
      renterId: RENTER_1_ID,
      page: 1,
      pageSize: 10,
      sort: "urgency",
    });

    expect(bookingsRepository.listDashboardByRenter).toHaveBeenCalledWith({
      renterId: RENTER_1_ID,
      status: undefined,
    });
    expect(rentingsRepository.listByRenterForDashboard).toHaveBeenCalledWith(
      RENTER_1_ID,
    );
    expect(result.summary).toEqual({
      upcoming: 1,
      active: 1,
      pending: 1,
      actionNeeded: 1,
      past: 1,
      cancelled: 1,
    });
    expect(
      result.items.find((item) => item.id === BOOKING_AWAITING_ID),
    ).toMatchObject({
      kind: "booking_request",
      id: BOOKING_AWAITING_ID,
      actionNeededCategory: "payment",
      isExpiringHold: true,
    });
    expect(
      result.items.some((item) => item.id === BOOKING_PAID_CONVERTED_ID),
    ).toBe(false);
  });

  it("filters renter dashboards by status before merging rentings", async () => {
    const awaitingPayment = createBookingRequestRecord({
      id: BOOKING_AWAITING_ID,
      status: "awaiting_payment",
    });
    const { service, bookingsRepository, rentingsRepository } = createService({
      dashboardBookings: [awaitingPayment],
      dashboardRentings: [createRentingRecord()],
    });

    const result = await service.dashboardMine({
      renterId: RENTER_1_ID,
      page: 1,
      pageSize: 10,
      sort: "urgency",
      status: "awaiting_payment",
      bucket: "action_needed",
    });

    expect(bookingsRepository.listDashboardByRenter).toHaveBeenCalledWith({
      renterId: RENTER_1_ID,
      status: "awaiting_payment",
    });
    expect(rentingsRepository.listByRenterForDashboard).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(BOOKING_AWAITING_ID);
  });

  it("builds owner dashboards with cross-posting scoping and action-needed filters", async () => {
    const pending = createBookingRequestRecord({
      id: BOOKING_PENDING_ID,
      postingId: POSTING_1_ID,
      posting: {
        id: POSTING_1_ID,
        name: "City loft",
        effectiveMaxBookingDurationDays: 30,
      },
      status: "pending",
      holdExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    const paymentFailed = createBookingRequestRecord({
      id: BOOKING_FAILED_ID,
      postingId: POSTING_2_ID,
      posting: {
        id: POSTING_2_ID,
        name: "Studio set",
        effectiveMaxBookingDurationDays: 30,
      },
      status: "payment_failed",
      holdExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    const converted = createBookingRequestRecord({
      id: BOOKING_CONVERTED_ID,
      postingId: POSTING_3_ID,
      status: "paid",
      convertedAt: "2099-04-21T00:00:00.000Z",
      rentingId: RENTING_3_ID,
    });
    const readyToConvert = createBookingRequestRecord({
      id: BOOKING_CONVERT_ID,
      postingId: POSTING_4_ID,
      posting: {
        id: POSTING_4_ID,
        name: "Canal cottage",
        effectiveMaxBookingDurationDays: 30,
      },
      status: "paid",
      holdExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });
    const ownerUpcomingRenting = createRentingRecord({
      id: RENTING_UPCOMING_ID,
      bookingRequestId: BOOKING_RENTING_UPCOMING_ID,
      status: "confirmed",
    });
    const ownerActiveRenting = createRentingRecord({
      id: RENTING_ACTIVE_ID,
      bookingRequestId: BOOKING_RENTING_ACTIVE_ID,
      status: "active",
    });
    const ownerPastRenting = createRentingRecord({
      id: RENTING_PAST_ID,
      bookingRequestId: BOOKING_RENTING_PAST_ID,
      status: "completed",
      completedAt: "2026-04-12T00:00:00.000Z",
      startAt: "2026-04-10T00:00:00.000Z",
      endAt: "2026-04-12T00:00:00.000Z",
    });
    const { service, bookingsRepository } = createService({
      dashboardOwnerBookings: [
        pending,
        paymentFailed,
        converted,
        readyToConvert,
      ],
      dashboardRentings: [
        ownerUpcomingRenting,
        ownerActiveRenting,
        ownerPastRenting,
      ],
      dashboardOwnerPostingOptions: [
        { id: POSTING_1_ID, name: "City loft" },
        { id: POSTING_2_ID, name: "Studio set" },
        { id: POSTING_4_ID, name: "Canal cottage" },
      ],
    });

    const result = await service.dashboardOwned({
      actorUserId: OWNER_1_ID,
      organizationId: ORG_1_ID,
      page: 1,
      pageSize: 10,
      sort: "urgency",
      actionNeeded: "conversion",
    });

    expect(bookingsRepository.listDashboardByOwner).toHaveBeenCalledWith({
      organizationId: ORG_1_ID,
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
      id: BOOKING_CONVERT_ID,
      actionNeededCategory: "conversion",
    });
    expect(result.postings).toEqual([
      { id: POSTING_1_ID, name: "City loft" },
      { id: POSTING_2_ID, name: "Studio set" },
      { id: POSTING_4_ID, name: "Canal cottage" },
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

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);

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
    const endAt = new Date(
      Date.now() + 60 * 60 * 1000 + 36 * 60 * 60 * 1000,
    ).toISOString();
    const { service } = createService({
      createdBooking: createBookingRequestRecord({
        status: "paid",
        startAt,
        endAt,
      }),
    });

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);

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

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);

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
    const {
      service,
      bookingsRepository,
      paymentsRepository,
      paymentProvider,
      analyticsRepository,
    } = createService({
      createdBooking: booking,
    });

    await expect(
      service.cancel({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: OWNER_1_ID,
      }),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Owners must provide a cancellation reason.",
    });

    const cancelled = await service.cancel({
      bookingRequestId: BOOKING_1_ID,
      actorUserId: OWNER_1_ID,
      reason: "Pipe burst in the unit.",
    });

    expect(paymentsRepository.createRefundRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_1_ID,
        actorUserId: OWNER_1_ID,
        amount: 330,
        reason: "Pipe burst in the unit.",
        idempotencyKey: `booking-cancel-${BOOKING_1_ID}`,
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
    expect(
      analyticsRepository.enqueueBookingCancelledEvent,
    ).toHaveBeenCalledTimes(1);
    expect(cancelled.status).toBe("cancelled");
  });

  it("allows renters to cancel unpaid bookings without creating refunds", async () => {
    const booking = createBookingRequestRecord({
      status: "awaiting_payment",
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const { service, bookingsRepository, paymentsRepository, paymentProvider } =
      createService({
        createdBooking: booking,
      });

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);
    expect(quote).toMatchObject({
      cancellable: true,
      actor: "renter",
      refundType: "none",
      refundAmount: 0,
    });

    await service.cancel({
      bookingRequestId: BOOKING_1_ID,
      actorUserId: RENTER_1_ID,
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
        rentingId: RENTING_1_ID,
      }),
    });

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);
    expect(quote.cancellable).toBe(false);
    expect(quote.failureReasons[0]?.code).toBe("booking_already_converted");

    await expect(
      service.cancel({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: RENTER_1_ID,
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

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);
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

    const quote = await service.getCancellationQuote(BOOKING_1_ID, RENTER_1_ID);
    expect(quote.cancellable).toBe(false);
    expect(quote.failureReasons[0]?.code).toBe(
      "payment_processing_in_progress",
    );

    await expect(
      service.cancel({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: RENTER_1_ID,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists renter booking requests directly from the repository", async () => {
    const { service, bookingsRepository } = createService() as any;
    bookingsRepository.listByRenter = jest.fn(async () => ({
      bookingRequests: [createBookingRequestRecord()],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    }));

    const result = await service.listMine({
      renterId: RENTER_1_ID,
      page: 2,
      pageSize: 5,
    } as any);

    expect(bookingsRepository.listByRenter).toHaveBeenCalledWith({
      renterId: RENTER_1_ID,
      page: 2,
      pageSize: 5,
    });
    expect(result.pagination.page).toBe(2);
  });

  it("returns a conflict when booking creation loses its conditional write race", async () => {
    const { service, bookingsRepository } = createService() as any;
    bookingsRepository.createIfWithinActiveRequestLimit.mockResolvedValue(null);

    await expect(
      service.create({
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
        startAt: "2099-05-01T00:00:00.000Z",
        endAt: "2099-05-04T00:00:00.000Z",
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns a conflict when approval or decline loses its conditional write race", async () => {
    const booking = createBookingRequestRecord({
      holdExpiresAt: "2099-04-21T00:00:00.000Z",
    });
    const { service, bookingsRepository } = createService({
      createdBooking: booking,
    });

    bookingsRepository.findById.mockResolvedValue(booking);
    bookingsRepository.approve.mockResolvedValueOnce(null);

    await expect(
      service.approve({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: OWNER_1_ID,
        note: "approve",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    bookingsRepository.decline.mockResolvedValueOnce(null);

    await expect(
      service.decline({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: OWNER_1_ID,
        note: "decline",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("treats missing or failed refunds as cancellation conflicts for paid bookings", async () => {
    const booking = createBookingRequestRecord({
      status: "paid",
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const missingPayment = createService({
      createdBooking: booking,
    });
    missingPayment.paymentsRepository.findByBookingRequestId.mockResolvedValue(
      null,
    );

    const unsupportedQuote = await missingPayment.service.getCancellationQuote(
      BOOKING_1_ID,
      RENTER_1_ID,
    );

    expect(unsupportedQuote).toMatchObject({
      cancellable: false,
      refundType: "unsupported",
    });
    await expect(
      missingPayment.service.cancel({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: RENTER_1_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    const failedRefund = createService({
      createdBooking: booking,
    });
    failedRefund.paymentProvider.createRefund.mockResolvedValueOnce({
      providerRefundId: "square-refund-1",
      status: "FAILED",
      raw: { ok: false },
    });

    await expect(
      failedRefund.service.cancel({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: OWNER_1_ID,
        reason: "Pipe burst in the unit.",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("wraps provider refund errors with classified conflict messaging", async () => {
    const booking = createBookingRequestRecord({
      status: "paid",
      startAt: "2099-05-10T00:00:00.000Z",
      endAt: "2099-05-12T00:00:00.000Z",
    });
    const { service, paymentProvider } = createService({
      createdBooking: booking,
    });
    paymentProvider.createRefund.mockRejectedValueOnce(
      new Error("gateway down"),
    );
    paymentProvider.classifyError.mockReturnValueOnce({
      category: "transient",
      code: "provider-down",
      message: "Provider temporarily unavailable.",
      retryable: true,
    });

    await expect(
      service.cancel({
        bookingRequestId: BOOKING_1_ID,
        actorUserId: OWNER_1_ID,
        reason: "Emergency maintenance",
      }),
    ).rejects.toThrow("Provider temporarily unavailable.");
  });

  it("covers booking helpers for normalization, guest counts, conflicts, and cancellation helpers", async () => {
    const { service } = createService();
    const helper = service as unknown as {
      resolveGuestCountOrThrow(
        guestCount: number | undefined,
        posting: PostingRecord,
      ): number;
      resolveGuestCountOrCollectFailures(
        guestCount: number | undefined,
        posting: PostingRecord,
        failureReasons: Array<Record<string, unknown>>,
      ): number;
      resolveMaxGuestCountForPosting(posting: PostingRecord): number;
      assertBookingRequestValidationPassed(validation: {
        normalized: unknown;
        failureReasons: Array<{ code: string; message: string }>;
      }): void;
      assertCanDecide(
        bookingRequest: BookingRequestRecord,
        action: "approve" | "decline",
      ): void;
      assertNoBlockingAvailabilityOverlap(
        postingId: string,
        startAt: Date,
        endAt: Date,
        excludeBookingRequestId?: string,
      ): Promise<void>;
      assertWithinPostingRequestCap(
        postingId: string,
        renterId: string,
        excludeBookingRequestId?: string,
      ): Promise<void>;
      assertNoRentingOverlap(
        postingId: string,
        startAt: Date,
        endAt: Date,
      ): Promise<void>;
      throwIfCancellationNotAllowed(assessment: {
        failureReasons: Array<{ code: string; message: string }>;
      }): void;
      resolveRemainingRefundableAmount(payment: {
        totalAmount: number;
        refunds: Array<{ status: string; amount: number }>;
      }): number;
      resolveCancellationRefundAmount(
        actor: "owner" | "renter",
        bookingStartAt: string,
        refundableAmount: number,
      ): number;
      resolveRefundType(refundableAmount: number, refundAmount: number): string;
    };

    expect(
      helper.resolveGuestCountOrThrow(
        undefined,
        createPostingRecord({
          variant: {
            family: "vehicle",
            subtype: "car",
          } as any,
        }),
      ),
    ).toBe(1);
    expect(() =>
      helper.resolveGuestCountOrThrow(undefined, createPostingRecord()),
    ).toThrow(BadRequestError);
    expect(() =>
      helper.resolveGuestCountOrThrow(9, createPostingRecord()),
    ).toThrow(BadRequestError);
    const failureReasons: Array<Record<string, unknown>> = [];
    expect(
      helper.resolveGuestCountOrCollectFailures(
        undefined,
        createPostingRecord(),
        failureReasons,
      ),
    ).toBe(1);
    expect(
      helper.resolveGuestCountOrCollectFailures(
        9,
        createPostingRecord(),
        failureReasons,
      ),
    ).toBe(9);
    expect(
      helper.resolveMaxGuestCountForPosting(
        createPostingRecord({
          details: {
            guest_capacity: 99,
            property_type: "loft",
            amenities: [],
          },
        }),
      ),
    ).toBe(20);
    expect(() =>
      helper.assertBookingRequestValidationPassed({
        normalized: {},
        failureReasons: [
          {
            code: "own_posting",
            message:
              "You cannot create a booking request for your own posting.",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      helper.assertCanDecide(
        createBookingRequestRecord({
          status: "declined",
        }),
        "approve",
      ),
    ).toThrow(BadRequestError);
    expect(() =>
      helper.assertCanDecide(
        createBookingRequestRecord({
          holdExpiresAt: "2020-01-01T00:00:00.000Z",
        }),
        "decline",
      ),
    ).toThrow(BadRequestError);

    const conflictContext = createService();
    conflictContext.bookingsRepository.hasBlockingAvailabilityOverlap.mockResolvedValueOnce(
      true,
    );
    await expect(
      (
        conflictContext.service as unknown as typeof helper
      ).assertNoBlockingAvailabilityOverlap(
        POSTING_1_ID,
        new Date("2099-05-01T00:00:00.000Z"),
        new Date("2099-05-04T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    conflictContext.bookingsRepository.countActiveRequestsForRenterPosting.mockResolvedValueOnce(
      2,
    );
    await expect(
      (
        conflictContext.service as unknown as typeof helper
      ).assertWithinPostingRequestCap(POSTING_1_ID, RENTER_1_ID),
    ).rejects.toBeInstanceOf(BadRequestError);
    conflictContext.rentingsRepository.hasOverlap.mockResolvedValueOnce(true);
    await expect(
      (
        conflictContext.service as unknown as typeof helper
      ).assertNoRentingOverlap(
        POSTING_1_ID,
        new Date("2099-05-01T00:00:00.000Z"),
        new Date("2099-05-04T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(() =>
      helper.throwIfCancellationNotAllowed({
        failureReasons: [
          {
            code: "payment_processing_in_progress",
            message: "wait",
          },
        ],
      }),
    ).toThrow(ConflictError);
    expect(() =>
      helper.throwIfCancellationNotAllowed({
        failureReasons: [
          {
            code: "booking_status_ineligible",
            message: "bad",
          },
        ],
      }),
    ).toThrow(BadRequestError);
    expect(
      helper.resolveRemainingRefundableAmount({
        totalAmount: 330,
        refunds: [
          {
            status: "succeeded",
            amount: 30,
          },
          {
            status: "pending",
            amount: 15,
          },
        ],
      }),
    ).toBe(300);
    expect(
      helper.resolveCancellationRefundAmount(
        "owner",
        "2099-05-10T00:00:00.000Z",
        330,
      ),
    ).toBe(330);
    expect(helper.resolveRefundType(0, 0)).toBe("none");
    expect(helper.resolveRefundType(330, 165)).toBe("partial");
    expect(helper.resolveRefundType(330, 330)).toBe("full");
  });
});
