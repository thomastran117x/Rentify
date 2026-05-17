import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingsService } from "@/features/bookings/bookings.service";
import type { CacheService } from "@/features/cache/cache.service";
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

function createService(options?: {
  activeRequestCount?: number;
  availabilityOverlap?: boolean;
  createdBooking?: BookingRequestRecord;
  posting?: PostingRecord;
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
  } as unknown as PostingsAnalyticsRepository;

  const rentingsRepository = {
    hasOverlap: jest.fn(async () => options?.rentingOverlap ?? false),
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

  const service = new BookingsService(
    bookingsRepository,
    postingsRepository,
    analyticsRepository,
    rentingsRepository,
    cacheService,
    postingsPublicCacheService,
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
      hasBlockingAvailabilityOverlap: jest.Mock;
    },
    analyticsRepository: analyticsRepository as unknown as {
      enqueueBookingRequestedEvent: jest.Mock;
      enqueueBookingApprovedEvent: jest.Mock;
      enqueueBookingDeclinedEvent: jest.Mock;
    },
    postingsRepository: postingsRepository as unknown as {
      findById: jest.Mock;
      enqueueSearchSync: jest.Mock;
    },
    rentingsRepository: rentingsRepository as unknown as {
      hasOverlap: jest.Mock;
    },
    cacheService: cacheService as unknown as {
      acquireLock: jest.Mock;
    },
    postingsPublicCacheService: postingsPublicCacheService as unknown as {
      invalidatePublic: jest.Mock;
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
});
