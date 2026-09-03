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
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import type { SeasonalPricingRecord } from "@/features/postings/seasonal-pricing/seasonal-pricing.model";
import { testUuid } from "../../support/uuid";

const R1_ID = testUuid(9000, 3583);
const R2_ID = testUuid(9000, 3584);

function createPostingRecord(
  overrides: Partial<PostingRecord> = {},
): PostingRecord {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "published",
    variant: { family: "place", subtype: "entire_place" },
    name: "City loft",
    description: "A bright loft.",
    pricing: { currency: "CAD", daily: { amount: 100 } },
    pricingCurrency: "CAD",
    photos: [],
    tags: [],
    details: { guest_capacity: 4, property_type: "loft", amenities: [] },
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 90,
    availabilityBlocks: [],
    location: {
      latitude: 43.65,
      longitude: -79.38,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as any;
}

function createCreatedBooking(
  overrides: Partial<BookingRequestRecord> = {},
): BookingRequestRecord {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "pending",
    startAt: "2099-05-01T00:00:00.000Z",
    endAt: "2099-05-08T00:00:00.000Z",
    durationDays: 7,
    guestCount: 2,
    contactName: "Jordan Lee",
    contactEmail: "jordan@example.com",
    contactPhoneNumber: undefined,
    pricingCurrency: "CAD",
    pricingSnapshot: { currency: "CAD", daily: { amount: 100 } },
    dailyPriceAmount: 100,
    estimatedTotal: 700,
    holdExpiresAt: "2026-04-25T00:00:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "City loft",
      effectiveMaxBookingDurationDays: 90,
    },
    ...overrides,
  } as any;
}

function buildSeasonalRule(
  overrides: Partial<SeasonalPricingRecord> = {},
): SeasonalPricingRecord {
  return {
    id: "rule-1",
    postingId: "posting-1",
    name: "Peak",
    startDate: "2099-05-01",
    endDate: "2099-05-03",
    dailyAmount: 200,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as any;
}

function createService(options?: {
  posting?: PostingRecord;
  seasonalRules?: SeasonalPricingRecord[];
  approveResult?: BookingRequestRecord | null;
}) {
  const posting = options?.posting ?? createPostingRecord();
  const created = createCreatedBooking();
  const approved: BookingRequestRecord = {
    ...created,
    status: "approved",
    approvedAt: new Date().toISOString(),
  };

  const cacheService = {
    acquireLock: jest.fn(async (key: string) => ({
      key,
      token: `${key}-token`,
      release: jest.fn(async () => true),
      extend: jest.fn(async () => true),
    })),
  } as unknown as CacheService;

  const bookingsRepository = {
    createIfWithinActiveRequestLimit: jest.fn(async () => created),
    approve: jest.fn(async () =>
      options?.approveResult !== undefined ? options.approveResult : approved,
    ),
    countActiveRequestsForRenterPosting: jest.fn(async () => 0),
    hasBlockingAvailabilityOverlap: jest.fn(async () => false),
    updatePending: jest.fn(async () => created),
    findById: jest.fn(async () => null),
    listByOwner: jest.fn(async () => ({
      bookingRequests: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    listDashboardByRenter: jest.fn(async () => []),
    listDashboardByOwner: jest.fn(async () => []),
    listDashboardPostingOptionsByOrganization: jest.fn(async () => []),
    cancel: jest.fn(async () => null),
    decline: jest.fn(async () => null),
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
    hasOverlap: jest.fn(async () => false),
    hasEligibleReviewRenting: jest.fn(async () => false),
  } as unknown as RentingsRepository;

  const postingsPublicCacheService = {
    invalidatePublic: jest.fn(async () => undefined),
  } as unknown as PostingsPublicCacheService;

  const paymentsRepository = {} as unknown as PaymentsRepository;
  const paymentProvider = {} as unknown as PaymentProviderAdapter;

  const organizationAccessService = {
    // Return membership only for owner users so renters don't hit "own_posting" guard
    findMembership: jest.fn(async (userId: string) =>
      userId.startsWith("owner")
        ? { organizationId: "org-1", userId, role: "primary_manager" }
        : null,
    ),
    assertCanManage: jest.fn(() => undefined),
  } as unknown as OrganizationAccessService;

  const seasonalRules = options?.seasonalRules ?? [];
  const seasonalPricingRepository = {
    findOverlappingForBooking: jest.fn(async () => seasonalRules),
  } as unknown as SeasonalPricingRepository;

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
    seasonalPricingRepository,
  );

  return {
    service,
    bookingsRepository,
    analyticsRepository,
    postingsPublicCacheService,
    seasonalPricingRepository,
  };
}

const BASE_QUOTE_INPUT = {
  postingId: "posting-1",
  renterId: "renter-1",
  startAt: "2099-05-01T00:00:00.000Z",
  endAt: "2099-05-04T00:00:00.000Z",
  guestCount: 2,
};

// The past-start cutoff is today at 00:00 UTC, so boundary cases have to be
// expressed relative to the run date rather than as literals that go stale.
function utcMidnightOffsetBy(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

describe("BookingsService — pricing and constraint enforcement", () => {
  describe("calculateEstimatedTotal — daily rate", () => {
    it("uses daily rate * durationDays for short stays", async () => {
      const { service } = createService({
        posting: createPostingRecord({
          pricing: { currency: "CAD", daily: { amount: 100 } },
        }),
      });

      const result = await service.quote({ ...BASE_QUOTE_INPUT });

      // 3 days × $100 = $300
      expect(result.estimatedTotal).toBe(300);
    });

    it("rounds daily-rate total to cents", async () => {
      const { service } = createService({
        posting: createPostingRecord({
          pricing: { currency: "CAD", daily: { amount: 33.33 } },
        }),
      });

      const result = await service.quote({ ...BASE_QUOTE_INPUT });

      // 3 × 33.33 = 99.99 — must not be 99.99000...01
      expect(result.estimatedTotal).toBe(99.99);
    });
  });

  describe("calculateEstimatedTotal — weekly rate", () => {
    it("applies weekly tiered rate for 7-day bookings", async () => {
      const { service } = createService({
        posting: createPostingRecord({
          pricing: {
            currency: "CAD",
            daily: { amount: 100 },
            weekly: { amount: 560 },
          },
          effectiveMaxBookingDurationDays: 90,
        }),
      });

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        endAt: "2099-05-08T00:00:00.000Z", // 7 days
      });

      // $560 / 7 × 7 = $560
      expect(result.estimatedTotal).toBe(560);
    });
  });

  describe("calculateEstimatedTotal — monthly rate", () => {
    it("applies monthly tiered rate for 28+ day bookings", async () => {
      const { service } = createService({
        posting: createPostingRecord({
          pricing: {
            currency: "CAD",
            daily: { amount: 100 },
            weekly: { amount: 560 },
            monthly: { amount: 2100 },
          },
          effectiveMaxBookingDurationDays: 90,
        }),
      });

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        endAt: "2099-05-29T00:00:00.000Z", // 28 days
      });

      // $2100 / 30 × 28 = $1960
      expect(result.estimatedTotal).toBe(1960);
    });
  });

  describe("calculateEstimatedTotal — seasonal rules", () => {
    it("applies seasonal rule dailyAmount for covered days, base rate for uncovered days", async () => {
      // 3-day booking: 2099-05-01 to 2099-05-04
      // Rule covers 2099-05-01 to 2099-05-02 @ $200/day (2 days)
      // Day 2099-05-03 is uncovered → $100/day
      const rule = buildSeasonalRule({
        startDate: "2099-05-01",
        endDate: "2099-05-02",
        dailyAmount: 200,
      });

      const { service } = createService({
        posting: createPostingRecord({
          pricing: { currency: "CAD", daily: { amount: 100 } },
        }),
        seasonalRules: [rule],
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      // 2 × 200 + 1 × 100 = 500
      expect(result.estimatedTotal).toBe(500);
    });

    it("applies base rate for all days when no rules overlap", async () => {
      const rule = buildSeasonalRule({
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        dailyAmount: 300,
      });

      const { service } = createService({
        posting: createPostingRecord({
          pricing: { currency: "CAD", daily: { amount: 100 } },
        }),
        seasonalRules: [rule],
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result.estimatedTotal).toBe(300); // 3 × 100
    });

    it("resolves overlapping seasonal rules by latest endDate wins", async () => {
      // Both rules cover 2099-05-01. 'Holiday' has the later endDate so it wins.
      const summer = buildSeasonalRule({
        id: R1_ID,
        startDate: "2026-04-01",
        endDate: "2099-05-15",
        dailyAmount: 150,
      });
      const holiday = buildSeasonalRule({
        id: R2_ID,
        startDate: "2099-05-01",
        endDate: "2099-05-31",
        dailyAmount: 250,
      });

      const { service } = createService({
        posting: createPostingRecord({
          pricing: { currency: "CAD", daily: { amount: 100 } },
        }),
        seasonalRules: [summer, holiday],
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      // All 3 days picked up by 'holiday' (endDate 2099-05-31 > 2099-05-15)
      expect(result.estimatedTotal).toBe(750); // 3 × 250
    });

    it("rounds each day addend to cents before accumulating (no IEEE 754 drift)", async () => {
      // Rule covers the full 3-day window with a non-terminating binary fraction.
      // Without per-day rounding: 33.333333 × 3 ≈ 99.999999 → would round to 100.
      // With per-day rounding: Math.round(33.333333 × 100)/100 = 33.33 per day → 99.99 total.
      const rule = buildSeasonalRule({
        startDate: "2099-05-01",
        endDate: "2099-05-31",
        dailyAmount: 33.333333,
      });

      const { service } = createService({
        posting: createPostingRecord({
          pricing: { currency: "CAD", daily: { amount: 100 } },
        }),
        seasonalRules: [rule],
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result.estimatedTotal).toBe(99.99);
    });
  });

  describe("booking constraint enforcement — minBookingDurationDays", () => {
    it("rejects create when booking is shorter than the minimum duration", async () => {
      const { service } = createService({
        posting: createPostingRecord({ minBookingDurationDays: 5 }),
      });

      await expect(
        service.create({
          ...BASE_QUOTE_INPUT,
          contactName: "Jordan Lee",
          contactEmail: "jordan@example.com",
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("returns min_duration_not_met failure reason in quote", async () => {
      const { service } = createService({
        posting: createPostingRecord({ minBookingDurationDays: 5 }),
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result.bookable).toBe(false);
      expect(result.failureReasons).toContainEqual(
        expect.objectContaining({ code: "min_duration_not_met" }),
      );
    });

    it("accepts a booking meeting the exact minimum duration", async () => {
      const { service } = createService({
        posting: createPostingRecord({ minBookingDurationDays: 3 }),
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result.failureReasons.map((r) => r.code)).not.toContain(
        "min_duration_not_met",
      );
    });
  });

  describe("booking constraint enforcement — past start dates", () => {
    it("returns start_date_in_past failure reason in quote for a past start", async () => {
      const { service } = createService();

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: utcMidnightOffsetBy(-3),
        endAt: utcMidnightOffsetBy(-1),
      });

      expect(result.bookable).toBe(false);
      expect(result.failureReasons).toContainEqual(
        expect.objectContaining({
          code: "start_date_in_past",
          field: "startAt",
        }),
      );
    });

    it("allows a start date of today", async () => {
      const { service } = createService();

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: utcMidnightOffsetBy(0),
        endAt: utcMidnightOffsetBy(3),
      });

      expect(result.failureReasons.map((r) => r.code)).not.toContain(
        "start_date_in_past",
      );
    });

    it("reports start_date_in_past ahead of advance_notice_not_met", async () => {
      const { service } = createService({
        posting: createPostingRecord({ advanceNoticeDays: 2 }),
      });

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: utcMidnightOffsetBy(-5),
        endAt: utcMidnightOffsetBy(-2),
      });

      const codes = result.failureReasons.map((r) => r.code);
      expect(codes).toContain("start_date_in_past");
      expect(codes).not.toContain("advance_notice_not_met");
    });

    it("rejects a time-specific start earlier today", async () => {
      const { service } = createService();

      // A window that already elapsed today: the calendar-day cutoff alone
      // would accept it, so this is held to the current instant instead.
      const elapsedStart = new Date();
      elapsedStart.setUTCHours(0, 0, 0, 0);
      elapsedStart.setUTCMilliseconds(1);
      const elapsedEnd = new Date(elapsedStart);
      elapsedEnd.setUTCMinutes(elapsedEnd.getUTCMinutes() + 30);

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: elapsedStart.toISOString(),
        endAt: elapsedEnd.toISOString(),
      });

      expect(result.bookable).toBe(false);
      expect(result.failureReasons).toContainEqual(
        expect.objectContaining({
          code: "start_date_in_past",
          message: "Booking start time cannot be in the past.",
        }),
      );
    });

    it("accepts a time-specific start later today", async () => {
      const { service } = createService();

      const upcomingStart = new Date(Date.now() + 60 * 60 * 1000);
      const upcomingEnd = new Date(upcomingStart);
      upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 2);

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: upcomingStart.toISOString(),
        endAt: upcomingEnd.toISOString(),
      });

      expect(result.failureReasons.map((r) => r.code)).not.toContain(
        "start_date_in_past",
      );
    });

    it("rejects create() when the start date is in the past", async () => {
      const { service, bookingsRepository } = createService();

      await expect(
        service.create({
          postingId: "posting-1",
          renterId: "renter-1",
          startAt: utcMidnightOffsetBy(-2),
          endAt: utcMidnightOffsetBy(1),
          guestCount: 2,
          contactName: "Jordan Lee",
          contactEmail: "jordan@example.com",
        } as any),
      ).rejects.toBeInstanceOf(BadRequestError);

      expect(
        bookingsRepository.createIfWithinActiveRequestLimit,
      ).not.toHaveBeenCalled();
    });
  });

  describe("booking constraint enforcement — advanceNoticeDays", () => {
    it("returns advance_notice_not_met failure reason in quote for same-day start", async () => {
      const { service } = createService({
        posting: createPostingRecord({ advanceNoticeDays: 2 }),
      });

      // Today is a valid start date on its own, but it does not clear the
      // 2-day notice requirement. Using today (not a past literal) keeps this
      // exercising advance notice rather than the past-start rule.
      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: utcMidnightOffsetBy(0),
        endAt: utcMidnightOffsetBy(3),
      });

      expect(result.bookable).toBe(false);
      expect(result.failureReasons).toContainEqual(
        expect.objectContaining({ code: "advance_notice_not_met" }),
      );
    });

    it("accepts a booking when advanceNoticeDays is 0 (same-day allowed)", async () => {
      const { service } = createService({
        posting: createPostingRecord({ advanceNoticeDays: 0 }),
      });

      // A far-future start is always past the 0-day notice requirement
      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        startAt: "2099-01-01T00:00:00.000Z",
        endAt: "2099-01-04T00:00:00.000Z",
      });

      expect(result.failureReasons.map((r) => r.code)).not.toContain(
        "advance_notice_not_met",
      );
    });
  });

  describe("instant booking auto-approval", () => {
    it("throws ConflictError when approve() returns null (unexpected transition)", async () => {
      const { service } = createService({
        posting: createPostingRecord({ instantBooking: true }),
        approveResult: null,
      });

      await expect(
        service.create({
          ...BASE_QUOTE_INPUT,
          contactName: "Jordan Lee",
          contactEmail: "jordan@example.com",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("fires booking_requested event before booking_approved for instant bookings", async () => {
      const { service, analyticsRepository } = createService({
        posting: createPostingRecord({ instantBooking: true }),
      });

      await service.create({
        ...BASE_QUOTE_INPUT,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      });

      const requestedCallOrder = (
        analyticsRepository.enqueueBookingRequestedEvent as jest.Mock
      ).mock.invocationCallOrder[0];
      const approvedCallOrder = (
        analyticsRepository.enqueueBookingApprovedEvent as jest.Mock
      ).mock.invocationCallOrder[0];

      expect(requestedCallOrder).toBeLessThan(approvedCallOrder);
    });

    it("returns a booking with autoApproved flag for instant-booking postings", async () => {
      const { service } = createService({
        posting: createPostingRecord({ instantBooking: true }),
      });

      const result = await service.create({
        ...BASE_QUOTE_INPUT,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      });

      expect((result as { autoApproved?: boolean }).autoApproved).toBe(true);
    });
  });

  describe("richer quote response metadata", () => {
    it("includes policy metadata from the posting in the quote result", async () => {
      const { service } = createService({
        posting: createPostingRecord({
          instantBooking: true,
          minBookingDurationDays: 2,
          advanceNoticeDays: 1,
          cancellationPolicy: "flexible",
          cancellationPolicyNotes: "Full refund 48h before.",
        }),
      });

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result).toMatchObject({
        instantBooking: true,
        minBookingDurationDays: 2,
        advanceNoticeDays: 1,
        cancellationPolicy: "flexible",
        cancellationPolicyNotes: "Full refund 48h before.",
      });
    });

    it("includes null policy fields when posting has none set", async () => {
      const { service } = createService();

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result.cancellationPolicy).toBeNull();
      expect(result.cancellationPolicyNotes).toBeNull();
      expect(result.minBookingDurationDays).toBeNull();
      expect(result.advanceNoticeDays).toBeNull();
    });
  });

  describe("quote — edge cases", () => {
    it("includes own_posting failure reason when the renter is an org member", async () => {
      const posting = createPostingRecord();
      const cacheService = {
        acquireLock: jest.fn(async (key: string) => ({
          key,
          token: `${key}-token`,
          release: jest.fn(async () => true),
          extend: jest.fn(async () => true),
        })),
      } as unknown as import("@/features/cache/cache.service").CacheService;

      const service = new (
        await import("@/features/bookings/bookings.service")
      ).BookingsService(
        {
          createIfWithinActiveRequestLimit: jest.fn(),
          countActiveRequestsForRenterPosting: jest.fn(async () => 0),
          hasBlockingAvailabilityOverlap: jest.fn(async () => false),
        } as any,
        {
          findById: jest.fn(async () => posting),
          enqueueSearchSync: jest.fn(),
        } as any,
        {
          enqueueBookingRequestedEvent: jest.fn(),
          enqueueBookingApprovedEvent: jest.fn(),
        } as any,
        { hasOverlap: jest.fn(async () => false) } as any,
        cacheService,
        { invalidatePublic: jest.fn() } as any,
        {} as any,
        {} as any,
        {
          findMembership: jest.fn(async () => ({
            organizationId: "org-1",
            userId: "renter-1",
            role: "member",
          })),
        } as any,
        { findOverlappingForBooking: jest.fn(async () => []) } as any,
      );

      const result = await service.quote(BASE_QUOTE_INPUT);

      expect(result.bookable).toBe(false);
      expect(result.failureReasons).toContainEqual(
        expect.objectContaining({ code: "own_posting" }),
      );
    });

    it("returns unconstrained guest count for non-place variant postings", async () => {
      const { service } = createService({
        posting: createPostingRecord({
          variant: { family: "item", subtype: "storage_space" } as any,
          pricing: { currency: "CAD", daily: { amount: 50 } },
          details: { amenities: [] } as any,
        }),
      });

      const result = await service.quote({
        ...BASE_QUOTE_INPUT,
        guestCount: 999,
      });

      expect(result.failureReasons.map((r) => r.code)).not.toContain(
        "guest_count_exceeded",
      );
      expect(result.estimatedTotal).toBe(150); // 3 × $50
    });
  });
});
