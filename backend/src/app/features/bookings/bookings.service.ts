import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  BookingQuoteFailureReason,
  BookingQuoteInput,
  BookingQuoteResult,
  BookingRequestRecord,
  BookingRequestsListResult,
  CreateBookingRequestInput,
  DecideBookingRequestInput,
  ListOwnerBookingRequestsInput,
  ListRenterBookingRequestsInput,
  UpdateBookingRequestInput,
} from "@/features/bookings/bookings.model";
import {
  APPROVED_BOOKING_HOLD_HOURS,
  BOOKING_DEFAULTS,
  MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING,
  MAX_BOOKING_GUEST_COUNT,
  MAX_BOOKING_NOTE_LENGTH,
  PENDING_BOOKING_HOLD_HOURS,
} from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import { flowLockKeys, withFlowLocks } from "@/features/cache/cache-locks";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingRecord } from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface NormalizedBookingRequestInput {
  startAt: Date;
  endAt: Date;
  durationDays: number;
  guestCount: number;
  note: string | null;
}

interface NormalizedCreateBookingRequestInput extends NormalizedBookingRequestInput {
  contactName: string;
  contactEmail: string;
  contactPhoneNumber: string | null;
}

interface BookingRequestValidationResult {
  posting: PostingRecord;
  normalized: NormalizedBookingRequestInput | null;
  maxBookingDurationDays: number;
  failureReasons: BookingQuoteFailureReason[];
}

export class BookingsService {
  constructor(
    private readonly bookingsRepository: BookingsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsAnalyticsRepository: PostingsAnalyticsRepository,
    private readonly rentingsRepository: RentingsRepository,
    private readonly cacheService: CacheService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {}

  async create(input: CreateBookingRequestInput): Promise<BookingRequestRecord> {
    const validation = await this.validateBookingRequest(input);
    this.assertBookingRequestValidationPassed(validation);

    const { posting } = validation;

    const created = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.postingBookingWindow(posting.id),
        flowLockKeys.bookingRequestCap(posting.id, input.renterId),
      ],
      async () => {
        const lockedValidation = await this.validateBookingRequest(input);
        this.assertBookingRequestValidationPassed(lockedValidation);

        const { posting: lockedPosting, normalized } = lockedValidation;
        const bookingRequest = await this.bookingsRepository.createIfWithinActiveRequestLimit(
          {
            postingId: lockedPosting.id,
            renterId: input.renterId,
            ownerId: lockedPosting.ownerId,
            startAt: normalized.startAt,
            endAt: normalized.endAt,
            durationDays: normalized.durationDays,
            guestCount: normalized.guestCount,
            contactName: input.contactName.trim(),
            contactEmail: input.contactEmail.trim().toLowerCase(),
            contactPhoneNumber: input.contactPhoneNumber?.trim() || null,
            note: normalized.note,
            pricingCurrency: lockedPosting.pricing.currency,
            pricingSnapshot: lockedPosting.pricing,
            dailyPriceAmount: lockedPosting.pricing.daily.amount,
            estimatedTotal: lockedPosting.pricing.daily.amount * normalized.durationDays,
            holdExpiresAt: this.addHours(new Date(), PENDING_BOOKING_HOLD_HOURS),
          },
          MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING,
        );

        if (!bookingRequest) {
          throw new ConflictError(
            "Another active booking request was created for this posting before your request could be saved.",
          );
        }

        return bookingRequest;
      },
      "Another request is already modifying this posting's booking availability. Please retry.",
    );

    await this.postingsAnalyticsRepository.enqueueBookingRequestedEvent({
      postingId: created.postingId,
      ownerId: created.ownerId,
      occurredAt: created.createdAt,
      estimatedTotal: created.estimatedTotal,
    });
    await invalidatePublicPostingProjection(this.postingsPublicCacheService, created.postingId);
    await this.postingsRepository.enqueueSearchSync(created.postingId);

    return created;
  }

  async quote(input: BookingQuoteInput): Promise<BookingQuoteResult> {
    const validation = await this.validateBookingRequest(input);
    const { posting, normalized } = validation;
    const estimatedTotal = normalized
      ? posting.pricing.daily.amount * normalized.durationDays
      : null;

    return {
      postingId: posting.id,
      bookable: validation.failureReasons.length === 0,
      durationDays: normalized?.durationDays ?? null,
      pricingCurrency: posting.pricing.currency,
      dailyPriceAmount: posting.pricing.daily.amount,
      estimatedTotal,
      maxBookingDurationDays: validation.maxBookingDurationDays,
      failureReasons: validation.failureReasons,
    };
  }

  async listMine(input: ListRenterBookingRequestsInput): Promise<BookingRequestsListResult> {
    return this.bookingsRepository.listByRenter(input);
  }

  async getById(id: string, userId: string): Promise<BookingRequestRecord> {
    const bookingRequest = await this.bookingsRepository.findById(id);

    if (!bookingRequest) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    if (bookingRequest.ownerId !== userId && bookingRequest.renterId !== userId) {
      throw new ForbiddenError("You do not have access to this booking request.");
    }

    return bookingRequest;
  }

  async updateOwnPending(input: UpdateBookingRequestInput): Promise<BookingRequestRecord> {
    const existing = await this.bookingsRepository.findById(input.bookingRequestId);

    if (!existing) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    if (existing.renterId !== input.renterId) {
      throw new ForbiddenError("You do not have access to this booking request.");
    }

    if (existing.status !== "pending") {
      throw new BadRequestError("Only pending booking requests can be updated.");
    }

    if (new Date(existing.holdExpiresAt).getTime() <= Date.now()) {
      throw new BadRequestError("This booking request has already expired.");
    }

    const updated = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestState(existing.id),
        flowLockKeys.postingBookingWindow(existing.postingId),
      ],
      async () => {
        const lockedBookingRequest = await this.bookingsRepository.findById(input.bookingRequestId);

        if (!lockedBookingRequest) {
          throw new ResourceNotFoundError("Booking request could not be found.");
        }

        if (lockedBookingRequest.renterId !== input.renterId) {
          throw new ForbiddenError("You do not have access to this booking request.");
        }

        if (lockedBookingRequest.status !== "pending") {
          throw new BadRequestError("Only pending booking requests can be updated.");
        }

        if (new Date(lockedBookingRequest.holdExpiresAt).getTime() <= Date.now()) {
          throw new BadRequestError("This booking request has already expired.");
        }

        const posting = await this.requirePostingEditableForRenter(lockedBookingRequest.postingId);
        const normalized = this.normalizeCreateInput(
          {
            postingId: lockedBookingRequest.postingId,
            renterId: input.renterId,
            startAt: input.startAt,
            endAt: input.endAt,
            guestCount: input.guestCount,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhoneNumber: input.contactPhoneNumber,
            note: input.note,
          },
          posting,
        );

        await this.assertNoBlockingAvailabilityOverlap(
          posting.id,
          normalized.startAt,
          normalized.endAt,
          lockedBookingRequest.id,
        );
        await this.assertNoRentingOverlap(posting.id, normalized.startAt, normalized.endAt);

        const nextBookingRequest = await this.bookingsRepository.updatePending(
          lockedBookingRequest.id,
          input.renterId,
          {
            startAt: normalized.startAt,
            endAt: normalized.endAt,
            durationDays: normalized.durationDays,
            guestCount: normalized.guestCount,
            contactName: normalized.contactName,
            contactEmail: normalized.contactEmail,
            contactPhoneNumber: normalized.contactPhoneNumber,
            note: normalized.note,
            pricingCurrency: posting.pricing.currency,
            pricingSnapshot: posting.pricing,
            dailyPriceAmount: posting.pricing.daily.amount,
            estimatedTotal: posting.pricing.daily.amount * normalized.durationDays,
          },
        );

        if (!nextBookingRequest) {
          throw new ConflictError(
            "This booking request changed before the update could be completed.",
          );
        }

        return nextBookingRequest;
      },
      "Another request is already modifying this booking request. Please retry.",
    );

    await invalidatePublicPostingProjection(this.postingsPublicCacheService, updated.postingId);
    await this.postingsRepository.enqueueSearchSync(updated.postingId);
    return updated;
  }

  async listForOwnerPosting(
    input: ListOwnerBookingRequestsInput,
  ): Promise<BookingRequestsListResult> {
    const posting = await this.postingsRepository.findById(input.postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (posting.ownerId !== input.ownerId) {
      throw new ForbiddenError("You do not have access to this posting.");
    }

    return this.bookingsRepository.listByOwnerAndPosting(input);
  }

  async approve(input: DecideBookingRequestInput): Promise<BookingRequestRecord> {
    const bookingRequest = await this.requireOwnerBookingRequest(input.bookingRequestId, input.ownerId);
    const approved = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestDecision(bookingRequest.id),
        flowLockKeys.bookingRequestState(bookingRequest.id),
        flowLockKeys.postingBookingWindow(bookingRequest.postingId),
      ],
      async () => {
        const lockedBookingRequest = await this.requireOwnerBookingRequest(
          input.bookingRequestId,
          input.ownerId,
        );

        this.assertCanDecide(lockedBookingRequest, "approve");
        await this.requirePostingActionableForOwner(lockedBookingRequest.postingId);
        await this.assertNoRentingOverlap(
          lockedBookingRequest.postingId,
          new Date(lockedBookingRequest.startAt),
          new Date(lockedBookingRequest.endAt),
        );
        await this.assertNoBlockingAvailabilityOverlap(
          lockedBookingRequest.postingId,
          new Date(lockedBookingRequest.startAt),
          new Date(lockedBookingRequest.endAt),
          lockedBookingRequest.id,
        );

        const nextBookingRequest = await this.bookingsRepository.approve(
          lockedBookingRequest.id,
          input.ownerId,
          input.note,
          this.addHours(new Date(), APPROVED_BOOKING_HOLD_HOURS),
        );

        if (!nextBookingRequest) {
          throw new ConflictError(
            "This booking request changed before it could be approved.",
          );
        }

        return nextBookingRequest;
      },
      "Another request is already deciding this booking request. Please retry.",
    );

    await this.postingsAnalyticsRepository.enqueueBookingApprovedEvent({
      postingId: approved.postingId,
      ownerId: approved.ownerId,
      occurredAt: approved.approvedAt ?? new Date().toISOString(),
    });
    await invalidatePublicPostingProjection(this.postingsPublicCacheService, approved.postingId);
    await this.postingsRepository.enqueueSearchSync(approved.postingId);
    return approved;
  }

  async decline(input: DecideBookingRequestInput): Promise<BookingRequestRecord> {
    const bookingRequest = await this.requireOwnerBookingRequest(input.bookingRequestId, input.ownerId);
    const declined = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestDecision(bookingRequest.id),
        flowLockKeys.bookingRequestState(bookingRequest.id),
      ],
      async () => {
        const lockedBookingRequest = await this.requireOwnerBookingRequest(
          input.bookingRequestId,
          input.ownerId,
        );

        this.assertCanDecide(lockedBookingRequest, "decline");

        const nextBookingRequest = await this.bookingsRepository.decline(
          lockedBookingRequest.id,
          input.ownerId,
          input.note,
        );

        if (!nextBookingRequest) {
          throw new ConflictError(
            "This booking request changed before it could be declined.",
          );
        }

        return nextBookingRequest;
      },
      "Another request is already deciding this booking request. Please retry.",
    );

    await this.postingsAnalyticsRepository.enqueueBookingDeclinedEvent({
      postingId: declined.postingId,
      ownerId: declined.ownerId,
      occurredAt: declined.declinedAt ?? new Date().toISOString(),
    });
    await invalidatePublicPostingProjection(this.postingsPublicCacheService, declined.postingId);
    await this.postingsRepository.enqueueSearchSync(declined.postingId);
    return declined;
  }

  private async requirePostingEditableForRenter(postingId: string): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (posting.archivedAt || posting.status !== "published") {
      throw new BadRequestError("Pending booking requests cannot be updated for this posting.");
    }

    return posting;
  }

  private async requirePostingActionableForOwner(postingId: string): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (posting.archivedAt || !["published", "paused"].includes(posting.status)) {
      throw new BadRequestError("This posting can no longer accept booking decisions.");
    }

    return posting;
  }

  private async requirePosting(postingId: string): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    return posting;
  }

  private async requireOwnerBookingRequest(
    bookingRequestId: string,
    ownerId: string,
  ): Promise<BookingRequestRecord> {
    const bookingRequest = await this.bookingsRepository.findById(bookingRequestId);

    if (!bookingRequest) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    if (bookingRequest.ownerId !== ownerId) {
      throw new ForbiddenError("You do not have access to this booking request.");
    }

    return bookingRequest;
  }

  private normalizeCreateInput(
    input: CreateBookingRequestInput,
    posting: PostingRecord,
  ): NormalizedCreateBookingRequestInput {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
      throw new BadRequestError("Booking request dates must define a valid, non-empty range.");
    }

    const durationDays = Math.ceil((endAt.getTime() - startAt.getTime()) / MILLISECONDS_PER_DAY);

    if (durationDays < 1) {
      throw new BadRequestError("Booking requests must be at least one day long.");
    }

    const effectiveMaxDuration =
      posting.maxBookingDurationDays ?? BOOKING_DEFAULTS.defaultMaxBookingDurationDays;

    if (durationDays > effectiveMaxDuration) {
      throw new BadRequestError(
        `Booking duration cannot exceed ${effectiveMaxDuration} day${effectiveMaxDuration === 1 ? "" : "s"}.`,
      );
    }

    const guestCount = this.resolveGuestCountOrThrow(input.guestCount, posting);

    const note = input.note?.trim() || null;
    const contactName = input.contactName.trim();
    const contactEmail = input.contactEmail.trim().toLowerCase();
    const contactPhoneNumber = input.contactPhoneNumber?.trim() || null;

    if (note && note.length > MAX_BOOKING_NOTE_LENGTH) {
      throw new BadRequestError(
        `Booking note cannot exceed ${MAX_BOOKING_NOTE_LENGTH} characters.`,
      );
    }

    return {
      ...input,
      startAt,
      endAt,
      guestCount,
      contactName,
      contactEmail,
      contactPhoneNumber,
      note,
      durationDays,
    };
  }

  private normalizeCreateInputForQuote(
    input: BookingQuoteInput,
    posting: PostingRecord,
    maxBookingDurationDays: number,
  ): {
    normalized: NormalizedBookingRequestInput | null;
    failureReasons: BookingQuoteFailureReason[];
  } {
    const failureReasons: BookingQuoteFailureReason[] = [];
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
      failureReasons.push({
        code: "invalid_dates",
        field: "startAt",
        message: "Booking request dates must define a valid, non-empty range.",
      });
      return {
        normalized: null,
        failureReasons,
      };
    }

    const durationDays = Math.ceil((endAt.getTime() - startAt.getTime()) / MILLISECONDS_PER_DAY);

    if (durationDays < 1) {
      failureReasons.push({
        code: "invalid_dates",
        field: "startAt",
        message: "Booking requests must be at least one day long.",
      });
    }

    if (durationDays > maxBookingDurationDays) {
      failureReasons.push({
        code: "max_duration_exceeded",
        field: "endAt",
        message: `Booking duration cannot exceed ${maxBookingDurationDays} day${maxBookingDurationDays === 1 ? "" : "s"}.`,
        details: {
          durationDays,
          maxBookingDurationDays,
        },
      });
    }

    const guestCount = this.resolveGuestCountOrCollectFailures(
      input.guestCount,
      posting,
      failureReasons,
    );

    const note = input.note?.trim() || null;

    if (note && note.length > MAX_BOOKING_NOTE_LENGTH) {
      failureReasons.push({
        code: "note_too_long",
        field: "note",
        message: `Booking note cannot exceed ${MAX_BOOKING_NOTE_LENGTH} characters.`,
        details: {
          maxLength: MAX_BOOKING_NOTE_LENGTH,
        },
      });
    }

    return {
      normalized: {
        startAt,
        endAt,
        guestCount,
        note,
        durationDays,
      },
      failureReasons,
    };
  }

  private async validateBookingRequest(
    input: BookingQuoteInput,
  ): Promise<BookingRequestValidationResult> {
    const posting = await this.requirePosting(input.postingId);
    const maxBookingDurationDays =
      posting.maxBookingDurationDays ?? BOOKING_DEFAULTS.defaultMaxBookingDurationDays;
    const failureReasons: BookingQuoteFailureReason[] = [];

    if (posting.status !== "published" || posting.archivedAt) {
      failureReasons.push({
        code: "posting_unavailable",
        message: "Booking requests are only allowed for published postings.",
      });
    }

    if (posting.ownerId === input.renterId) {
      failureReasons.push({
        code: "own_posting",
        message: "You cannot create a booking request for your own posting.",
      });
    }

    const normalizedResult = this.normalizeCreateInputForQuote(
      input,
      posting,
      maxBookingDurationDays,
    );
    failureReasons.push(...normalizedResult.failureReasons);

    if (normalizedResult.normalized) {
      const [rentingOverlap, availabilityOverlap, activeRequestCount] = await Promise.all([
        this.rentingsRepository.hasOverlap(
          posting.id,
          normalizedResult.normalized.startAt,
          normalizedResult.normalized.endAt,
        ),
        this.bookingsRepository.hasBlockingAvailabilityOverlap({
          postingId: posting.id,
          startAt: normalizedResult.normalized.startAt,
          endAt: normalizedResult.normalized.endAt,
          excludeBookingRequestId: undefined,
        }),
        this.bookingsRepository.countActiveRequestsForRenterPosting({
          postingId: posting.id,
          renterId: input.renterId,
          excludeBookingRequestId: undefined,
        }),
      ]);

      if (rentingOverlap) {
        failureReasons.push({
          code: "renting_overlap",
          message: "The requested dates are already reserved by an existing renting.",
        });
      }

      if (availabilityOverlap) {
        failureReasons.push({
          code: "availability_block_overlap",
          message: "The requested dates overlap with existing availability blocks.",
        });
      }

      if (activeRequestCount >= MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING) {
        failureReasons.push({
          code: "active_request_limit_exceeded",
          message: `You can only keep ${MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING} active booking requests for this posting at a time. Please update or complete an existing request before creating another.`,
          details: {
            activeRequestCount,
            maxActiveRequests: MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING,
          },
        });
      }
    }

    return {
      posting,
      normalized: normalizedResult.normalized,
      maxBookingDurationDays,
      failureReasons,
    };
  }

  private resolveGuestCountOrThrow(guestCount: number | undefined, posting: PostingRecord): number {
    if (posting.variant.family !== "place") {
      return 1;
    }

    if (guestCount === undefined || !Number.isInteger(guestCount) || guestCount < 1) {
      throw new BadRequestError("Guest count must be a positive integer.");
    }

    const normalizedGuestCount = guestCount as number;
    const maxGuestCount = this.resolveMaxGuestCountForPosting(posting);

    if (normalizedGuestCount > maxGuestCount) {
      throw new BadRequestError(`Guest count cannot exceed ${maxGuestCount}.`);
    }

    return normalizedGuestCount;
  }

  private resolveGuestCountOrCollectFailures(
    guestCount: number | undefined,
    posting: PostingRecord,
    failureReasons: BookingQuoteFailureReason[],
  ): number {
    if (posting.variant.family !== "place") {
      return 1;
    }

    if (guestCount === undefined || !Number.isInteger(guestCount) || guestCount < 1) {
      failureReasons.push({
        code: "invalid_guest_count",
        field: "guestCount",
        message: "Guest count must be a positive integer.",
      });
      return 1;
    }

    const normalizedGuestCount = guestCount as number;
    const maxGuestCount = this.resolveMaxGuestCountForPosting(posting);

    if (normalizedGuestCount > maxGuestCount) {
      failureReasons.push({
        code: "guest_count_exceeded",
        field: "guestCount",
        message: `Guest count cannot exceed ${maxGuestCount}.`,
        details: {
          maxGuestCount,
        },
      });
    }

    return normalizedGuestCount;
  }

  private resolveMaxGuestCountForPosting(posting: PostingRecord): number {
    if (posting.variant.family !== "place") {
      return MAX_BOOKING_GUEST_COUNT;
    }

    const details = posting.details as {
      guest_capacity: number;
    };

    return Math.min(details.guest_capacity, MAX_BOOKING_GUEST_COUNT);
  }

  private assertBookingRequestValidationPassed(
    validation: BookingRequestValidationResult,
  ): asserts validation is BookingRequestValidationResult & {
    normalized: NormalizedBookingRequestInput;
  } {
    const firstFailure = validation.failureReasons[0];

    if (!firstFailure || !validation.normalized) {
      return;
    }

    if (firstFailure.code === "own_posting") {
      throw new ForbiddenError(firstFailure.message);
    }

    throw new BadRequestError(firstFailure.message);
  }

  private assertCanDecide(
    bookingRequest: BookingRequestRecord,
    action: "approve" | "decline",
  ): void {
    if (bookingRequest.status !== "pending") {
      throw new BadRequestError(
        `Only pending booking requests can be ${action === "approve" ? "approved" : "declined"}.`,
      );
    }

    if (new Date(bookingRequest.holdExpiresAt).getTime() <= Date.now()) {
      throw new BadRequestError("This booking request has already expired.");
    }
  }

  private async assertNoBlockingAvailabilityOverlap(
    postingId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingRequestId?: string,
  ): Promise<void> {
    const overlap = await this.bookingsRepository.hasBlockingAvailabilityOverlap({
      postingId,
      startAt,
      endAt,
      excludeBookingRequestId,
    });

    if (overlap) {
      throw new BadRequestError("The requested dates overlap with existing availability blocks.");
    }
  }

  private async assertWithinPostingRequestCap(
    postingId: string,
    renterId: string,
    excludeBookingRequestId?: string,
  ): Promise<void> {
    const activeRequestCount = await this.bookingsRepository.countActiveRequestsForRenterPosting({
      postingId,
      renterId,
      excludeBookingRequestId,
    });

    if (activeRequestCount >= MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING) {
      throw new BadRequestError(
        `You can only keep ${MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING} active booking requests for this posting at a time. Please update or complete an existing request before creating another.`,
      );
    }
  }

  private async assertNoRentingOverlap(postingId: string, startAt: Date, endAt: Date): Promise<void> {
    const overlap = await this.rentingsRepository.hasOverlap(postingId, startAt, endAt);

    if (overlap) {
      throw new BadRequestError("The requested dates are already reserved by an existing renting.");
    }
  }

  private addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }
}
