import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  BookingDashboardItem,
  BookingDashboardSort,
  BookingCancellationActor,
  BookingCancellationFailureReason,
  BookingCancellationQuoteResult,
  BookingCancellationRefundType,
  BookingQuoteFailureReason,
  BookingQuoteInput,
  BookingQuoteResult,
  BookingRequestRecord,
  BookingRequestsListResult,
  CancelBookingRequestInput,
  CreateBookingRequestInput,
  DecideBookingRequestInput,
  ListOwnedBookingRequestsInput,
  ListOwnerBookingRequestsInput,
  ListRenterBookingRequestsInput,
  OwnerBookingDashboardActionNeeded,
  OwnerBookingDashboardInput,
  OwnerBookingDashboardResult,
  RenterBookingDashboardBucket,
  RenterBookingDashboardInput,
  RenterBookingDashboardResult,
  UpdateBookingRequestInput,
} from "@/features/bookings/bookings.model";
import {
  APPROVED_BOOKING_HOLD_HOURS,
  BOOKING_DEFAULTS,
  BOOKING_CANCELLATION_POLICY_CODE,
  FULL_REFUND_CUTOFF_HOURS,
  MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING,
  MAX_BOOKING_CANCELLATION_REASON_LENGTH,
  MAX_BOOKING_GUEST_COUNT,
  MAX_BOOKING_NOTE_LENGTH,
  PARTIAL_REFUND_CUTOFF_HOURS,
  PENDING_BOOKING_HOLD_HOURS,
} from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import { flowLockKeys, withFlowLocks } from "@/features/cache/cache-locks";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type {
  PostingPricing,
  PostingRecord,
} from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import type { SeasonalPricingRecord } from "@/features/postings/seasonal-pricing/seasonal-pricing.model";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import type { PaymentsRepository } from "@/features/payments/payments.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { RentingRecord } from "@/features/rentings/rentings.model";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

interface NormalizedBookingRequestInput {
  startAt: Date;
  endAt: Date;
  durationDays: number;
  guestCount: number;
  note: string | null;
}

interface NormalizedCreateBookingRequestInput
  extends NormalizedBookingRequestInput {
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

interface BookingCancellationAssessment {
  actor: BookingCancellationActor;
  reasonRequired: boolean;
  refundType: BookingCancellationRefundType;
  refundAmount: number;
  currency: string;
  failureReasons: BookingCancellationFailureReason[];
}

export class BookingsService {
  constructor(
    private readonly bookingsRepository: BookingsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsAnalyticsRepository: PostingsAnalyticsRepository,
    private readonly rentingsRepository: RentingsRepository,
    private readonly cacheService: CacheService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentProvider: PaymentProviderAdapter,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly seasonalPricingRepository: SeasonalPricingRepository,
  ) {}

  async create(
    input: CreateBookingRequestInput,
  ): Promise<BookingRequestRecord> {
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
        const bookingRequest =
          await this.bookingsRepository.createIfWithinActiveRequestLimit(
            {
              postingId: lockedPosting.id,
              renterId: input.renterId,
              organizationId: lockedPosting.organizationId,
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
              estimatedTotal: this.calculateEstimatedTotal(
                lockedPosting.pricing,
                normalized.durationDays,
                normalized.startAt,
                await this.seasonalPricingRepository.findOverlappingForBooking(
                  lockedPosting.id,
                  normalized.startAt,
                  normalized.endAt,
                ),
              ),
              holdExpiresAt: this.addHours(
                new Date(),
                PENDING_BOOKING_HOLD_HOURS,
              ),
            },
            MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING,
          );

        if (!bookingRequest) {
          throw new ConflictError(
            "Another active booking request was created for this posting before your request could be saved.",
          );
        }

        if (lockedPosting.instantBooking) {
          const approved = await this.bookingsRepository.approve(
            bookingRequest.id,
            bookingRequest.organizationId,
            null,
            this.addHours(new Date(), APPROVED_BOOKING_HOLD_HOURS),
          );
          if (!approved) {
            throw new ConflictError(
              "Booking was created but could not be instantly approved. Please try again.",
            );
          }
          return { ...approved, autoApproved: true as const };
        }

        return bookingRequest;
      },
      "Another request is already modifying this posting's booking availability. Please retry.",
    );

    // Fire booking_requested with the original pending record, then booking_approved separately
    // so analytics pipelines always see a clean pending→approved state transition.
    await this.postingsAnalyticsRepository.enqueueBookingRequestedEvent({
      postingId: created.postingId,
      organizationId: created.organizationId,
      occurredAt: created.createdAt,
      estimatedTotal: created.estimatedTotal,
    });

    if ("autoApproved" in created && created.autoApproved) {
      await this.postingsAnalyticsRepository.enqueueBookingApprovedEvent({
        postingId: created.postingId,
        organizationId: created.organizationId,
        occurredAt: created.approvedAt ?? new Date().toISOString(),
      });
    }

    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      created.postingId,
    );
    await this.postingsRepository.enqueueSearchSync(created.postingId);

    return created;
  }

  async quote(input: BookingQuoteInput): Promise<BookingQuoteResult> {
    const validation = await this.validateBookingRequest(input);
    const { posting, normalized } = validation;
    const seasonalRules = normalized
      ? await this.seasonalPricingRepository.findOverlappingForBooking(
          posting.id,
          normalized.startAt,
          normalized.endAt,
        )
      : [];
    const estimatedTotal = normalized
      ? this.calculateEstimatedTotal(
          posting.pricing,
          normalized.durationDays,
          normalized.startAt,
          seasonalRules,
        )
      : null;

    return {
      postingId: posting.id,
      bookable: validation.failureReasons.length === 0,
      durationDays: normalized?.durationDays ?? null,
      pricingCurrency: posting.pricing.currency,
      dailyPriceAmount: posting.pricing.daily.amount,
      estimatedTotal,
      maxBookingDurationDays: validation.maxBookingDurationDays,
      minBookingDurationDays: posting.minBookingDurationDays ?? null,
      advanceNoticeDays: posting.advanceNoticeDays ?? null,
      instantBooking: posting.instantBooking,
      cancellationPolicy: posting.cancellationPolicy ?? null,
      cancellationPolicyNotes: posting.cancellationPolicyNotes ?? null,
      failureReasons: validation.failureReasons,
    };
  }

  async listMine(
    input: ListRenterBookingRequestsInput,
  ): Promise<BookingRequestsListResult> {
    return this.bookingsRepository.listByRenter(input);
  }

  async listOwned(
    input: ListOwnedBookingRequestsInput,
  ): Promise<BookingRequestsListResult> {
    const membership =
      await this.organizationAccessService.requireActiveMembership(
        input.actorUserId,
        "Select or join an organization before managing bookings.",
      );

    return this.bookingsRepository.listByOwner({
      ...input,
      organizationId: membership.organizationId,
    });
  }

  async dashboardMine(
    input: RenterBookingDashboardInput,
  ): Promise<RenterBookingDashboardResult> {
    const [bookingRequests, rentings] = await Promise.all([
      this.bookingsRepository.listDashboardByRenter({
        renterId: input.renterId,
        status: input.status,
      }),
      input.status
        ? Promise.resolve([])
        : this.rentingsRepository.listByRenterForDashboard(input.renterId),
    ]);

    const items = [
      ...bookingRequests
        .filter((bookingRequest) => !this.isConvertedBooking(bookingRequest))
        .map((bookingRequest) =>
          this.toRenterDashboardBookingItem(bookingRequest),
        ),
      ...rentings.map((renting) => this.toRenterDashboardRentingItem(renting)),
    ];

    const summary = items.reduce(
      (counts, item) => {
        const bucket = this.resolveRenterBucket(item);

        if (bucket === "action_needed") {
          counts.actionNeeded += 1;
        } else if (bucket === "upcoming") {
          counts.upcoming += 1;
        } else if (bucket === "active") {
          counts.active += 1;
        } else if (bucket === "pending") {
          counts.pending += 1;
        } else if (bucket === "past") {
          counts.past += 1;
        } else if (bucket === "cancelled") {
          counts.cancelled += 1;
        }

        return counts;
      },
      {
        upcoming: 0,
        active: 0,
        pending: 0,
        actionNeeded: 0,
        past: 0,
        cancelled: 0,
      },
    );

    const filteredItems = items.filter((item) =>
      input.bucket ? this.resolveRenterBucket(item) === input.bucket : true,
    );
    const sortedItems = this.sortDashboardItems(filteredItems, input.sort);
    const { items: pagedItems, pagination } = this.paginateDashboardItems(
      sortedItems,
      input.page,
      input.pageSize,
    );

    return {
      summary,
      items: pagedItems,
      pagination,
      filters: {
        page: input.page,
        pageSize: input.pageSize,
        sort: input.sort,
        bucket: input.bucket,
        status: input.status,
      },
    };
  }

  async dashboardOwned(
    input: OwnerBookingDashboardInput,
  ): Promise<OwnerBookingDashboardResult> {
    const membership =
      await this.organizationAccessService.requireActiveMembership(
        input.actorUserId,
        "Select or join an organization before managing bookings.",
      );
    const [bookingRequests, postings] = await Promise.all([
      this.bookingsRepository.listDashboardByOwner({
        organizationId: membership.organizationId,
        status: input.status,
        postingId: input.postingId,
      }),
      this.bookingsRepository.listDashboardPostingOptionsByOrganization(
        membership.organizationId,
      ),
    ]);

    const rentings = input.status
      ? []
      : await this.rentingsRepository.listByOwnerForDashboard({
          organizationId: membership.organizationId,
          postingId: input.postingId,
        });

    const items = [
      ...bookingRequests
        .filter((bookingRequest) => !this.isConvertedBooking(bookingRequest))
        .map((bookingRequest) => this.toOwnerDashboardItem(bookingRequest)),
      ...rentings.map((renting) => this.toOwnerDashboardRentingItem(renting)),
    ];

    const summary = items.reduce(
      (counts, item) => {
        if (!this.isOwnerDashboardOpenItem(item)) {
          const rentingPhase = this.resolveRentingPhase(item);

          if (rentingPhase === "upcoming") {
            counts.upcomingRentings += 1;
          } else if (rentingPhase === "active") {
            counts.activeRentings += 1;
          } else if (rentingPhase === "past") {
            counts.pastRentings += 1;
          }

          return counts;
        }

        counts.totalOpen += 1;

        if (item.actionNeededCategory === "approval") {
          counts.approval += 1;
        }

        if (item.actionNeededCategory === "payment") {
          counts.payment += 1;
        }

        if (item.actionNeededCategory === "payment_failure") {
          counts.paymentFailure += 1;
        }

        if (item.actionNeededCategory === "conversion") {
          counts.conversion += 1;
        }

        if (item.isExpiringHold) {
          counts.expiringHold += 1;
        }

        return counts;
      },
      {
        approval: 0,
        payment: 0,
        expiringHold: 0,
        paymentFailure: 0,
        conversion: 0,
        upcomingRentings: 0,
        activeRentings: 0,
        pastRentings: 0,
        totalOpen: 0,
      },
    );

    const filteredItems = items.filter((item) =>
      input.actionNeeded
        ? this.matchesOwnerActionNeeded(item, input.actionNeeded)
        : true,
    );
    const sortedItems = this.sortDashboardItems(filteredItems, input.sort);
    const { items: pagedItems, pagination } = this.paginateDashboardItems(
      sortedItems,
      input.page,
      input.pageSize,
    );

    return {
      summary,
      items: pagedItems,
      postings,
      pagination,
      filters: {
        page: input.page,
        pageSize: input.pageSize,
        sort: input.sort,
        status: input.status,
        actionNeeded: input.actionNeeded,
        postingId: input.postingId,
      },
    };
  }

  async getById(id: string, userId: string): Promise<BookingRequestRecord> {
    const bookingRequest = await this.bookingsRepository.findById(id);

    if (!bookingRequest) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    const membership = await this.organizationAccessService.findMembership(
      userId,
      bookingRequest.organizationId,
    );

    if (!membership && bookingRequest.renterId !== userId) {
      throw new ForbiddenError(
        "You do not have access to this booking request.",
      );
    }

    return bookingRequest;
  }

  async updateOwnPending(
    input: UpdateBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    const existing = await this.bookingsRepository.findById(
      input.bookingRequestId,
    );

    if (!existing) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    if (existing.renterId !== input.renterId) {
      throw new ForbiddenError(
        "You do not have access to this booking request.",
      );
    }

    if (existing.status !== "pending") {
      throw new BadRequestError(
        "Only pending booking requests can be updated.",
      );
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
        const lockedBookingRequest = await this.bookingsRepository.findById(
          input.bookingRequestId,
        );

        if (!lockedBookingRequest) {
          throw new ResourceNotFoundError(
            "Booking request could not be found.",
          );
        }

        if (lockedBookingRequest.renterId !== input.renterId) {
          throw new ForbiddenError(
            "You do not have access to this booking request.",
          );
        }

        if (lockedBookingRequest.status !== "pending") {
          throw new BadRequestError(
            "Only pending booking requests can be updated.",
          );
        }

        if (
          new Date(lockedBookingRequest.holdExpiresAt).getTime() <= Date.now()
        ) {
          throw new BadRequestError(
            "This booking request has already expired.",
          );
        }

        const posting = await this.requirePostingEditableForRenter(
          lockedBookingRequest.postingId,
        );
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
        await this.assertNoRentingOverlap(
          posting.id,
          normalized.startAt,
          normalized.endAt,
        );

        const updateSeasonalRules =
          await this.seasonalPricingRepository.findOverlappingForBooking(
            posting.id,
            normalized.startAt,
            normalized.endAt,
          );

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
            estimatedTotal: this.calculateEstimatedTotal(
              posting.pricing,
              normalized.durationDays,
              normalized.startAt,
              updateSeasonalRules,
            ),
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

    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      updated.postingId,
    );
    await this.postingsRepository.enqueueSearchSync(updated.postingId);
    return updated;
  }

  async getCancellationQuote(
    bookingRequestId: string,
    userId: string,
  ): Promise<BookingCancellationQuoteResult> {
    const bookingRequest = await this.getById(bookingRequestId, userId);
    const assessment = await this.assessCancellation(bookingRequest, userId);

    return {
      bookingRequestId: bookingRequest.id,
      cancellable: assessment.failureReasons.length === 0,
      actor: assessment.actor,
      bookingStatus: bookingRequest.status,
      reasonRequired: assessment.reasonRequired,
      policyCode: BOOKING_CANCELLATION_POLICY_CODE,
      refundType: assessment.refundType,
      refundAmount: assessment.refundAmount,
      currency: assessment.currency,
      failureReasons: assessment.failureReasons,
    };
  }

  async cancel(
    input: CancelBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    const bookingRequest = await this.getById(
      input.bookingRequestId,
      input.actorUserId,
    );
    const actor = await this.resolveCancellationActor(
      bookingRequest,
      input.actorUserId,
    );
    const reason = this.normalizeCancellationReason(input.reason);

    if (actor === "owner" && !reason) {
      throw new BadRequestError("Owners must provide a cancellation reason.");
    }

    const cancelled = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestDecision(bookingRequest.id),
        flowLockKeys.bookingRequestState(bookingRequest.id),
        flowLockKeys.postingBookingWindow(bookingRequest.postingId),
      ],
      async () => {
        const lockedBookingRequest = await this.getById(
          input.bookingRequestId,
          input.actorUserId,
        );
        const assessment = await this.assessCancellation(
          lockedBookingRequest,
          input.actorUserId,
        );

        this.throwIfCancellationNotAllowed(assessment);

        if (
          lockedBookingRequest.status === "paid" &&
          assessment.refundAmount > 0
        ) {
          await this.refundCancelledPaidBooking(
            lockedBookingRequest,
            input.actorUserId,
            assessment.refundAmount,
            reason,
            assessment.currency,
          );
        }

        const nextBookingRequest = await this.bookingsRepository.cancel({
          bookingRequestId: lockedBookingRequest.id,
          actorUserId: input.actorUserId,
          actor: assessment.actor,
          actorOrganizationId:
            assessment.actor === "owner"
              ? lockedBookingRequest.organizationId
              : undefined,
          expectedStatus: lockedBookingRequest.status,
          reason,
          cancellationPolicyCode: BOOKING_CANCELLATION_POLICY_CODE,
          cancellationRefundAmount: assessment.refundAmount,
        });

        if (!nextBookingRequest) {
          throw new ConflictError(
            "This booking request changed before it could be cancelled.",
          );
        }

        return nextBookingRequest;
      },
      "Another request is already modifying this booking request. Please retry.",
    );

    await this.postingsAnalyticsRepository.enqueueBookingCancelledEvent({
      postingId: cancelled.postingId,
      organizationId: cancelled.organizationId,
      occurredAt: cancelled.cancelledAt ?? new Date().toISOString(),
    });
    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      cancelled.postingId,
    );
    await this.postingsRepository.enqueueSearchSync(cancelled.postingId);
    return cancelled;
  }

  async listForOwnerPosting(
    input: ListOwnerBookingRequestsInput,
  ): Promise<BookingRequestsListResult> {
    const posting = await this.postingsRepository.findById(input.postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    const membership = await this.organizationAccessService.requireMembership(
      input.actorUserId,
      posting.organizationId,
      "You do not have access to this posting.",
    );
    if (posting.organizationId !== membership.organizationId) {
      throw new ForbiddenError("You do not have access to this posting.");
    }

    return this.bookingsRepository.listByOwnerAndPosting({
      ...input,
      organizationId: membership.organizationId,
    });
  }

  async approve(
    input: DecideBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    const bookingRequest = await this.requireOrganizationBookingRequest(
      input.bookingRequestId,
      input.actorUserId,
      "manage",
    );
    const approved = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestDecision(bookingRequest.id),
        flowLockKeys.bookingRequestState(bookingRequest.id),
        flowLockKeys.postingBookingWindow(bookingRequest.postingId),
      ],
      async () => {
        const lockedBookingRequest =
          await this.requireOrganizationBookingRequest(
            input.bookingRequestId,
            input.actorUserId,
            "manage",
          );

        this.assertCanDecide(lockedBookingRequest, "approve");
        await this.requirePostingActionableForOrganization(
          lockedBookingRequest.postingId,
        );
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
          lockedBookingRequest.organizationId,
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
      organizationId: approved.organizationId,
      occurredAt: approved.approvedAt ?? new Date().toISOString(),
    });
    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      approved.postingId,
    );
    await this.postingsRepository.enqueueSearchSync(approved.postingId);
    return approved;
  }

  async decline(
    input: DecideBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    const bookingRequest = await this.requireOrganizationBookingRequest(
      input.bookingRequestId,
      input.actorUserId,
      "manage",
    );
    const declined = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestDecision(bookingRequest.id),
        flowLockKeys.bookingRequestState(bookingRequest.id),
      ],
      async () => {
        const lockedBookingRequest =
          await this.requireOrganizationBookingRequest(
            input.bookingRequestId,
            input.actorUserId,
            "manage",
          );

        this.assertCanDecide(lockedBookingRequest, "decline");

        const nextBookingRequest = await this.bookingsRepository.decline(
          lockedBookingRequest.id,
          lockedBookingRequest.organizationId,
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
      organizationId: declined.organizationId,
      occurredAt: declined.declinedAt ?? new Date().toISOString(),
    });
    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      declined.postingId,
    );
    await this.postingsRepository.enqueueSearchSync(declined.postingId);
    return declined;
  }

  private toRenterDashboardBookingItem(
    bookingRequest: BookingRequestRecord,
  ): BookingDashboardItem {
    const isExpiringHold = this.isExpiringHold(
      bookingRequest.holdExpiresAt,
      bookingRequest.status,
    );
    const isPaymentAction =
      bookingRequest.status === "approved" ||
      bookingRequest.status === "awaiting_payment";
    const isPaymentFailure = bookingRequest.status === "payment_failed";
    const isPending = bookingRequest.status === "pending";
    const isPaid = bookingRequest.status === "paid";
    const isTerminal = this.isTerminalBookingStatus(bookingRequest.status);
    const nextAction = isPaymentFailure
      ? {
          code: "retry_payment" as const,
          label: "Retry payment before the hold expires.",
        }
      : isPaymentAction
        ? {
            code: "complete_payment" as const,
            label: "Complete payment before the hold expires.",
          }
        : isPending
          ? {
              code: "await_owner_response" as const,
              label: "Wait for the owner to approve or decline this request.",
            }
          : isPaid
            ? {
                code: "monitor_upcoming" as const,
                label:
                  "Your booking is secured. Watch for the upcoming rental window.",
              }
            : {
                code: "none" as const,
                label: "No next action is required.",
              };
    const deadlineAt = isTerminal ? undefined : bookingRequest.holdExpiresAt;

    return {
      id: bookingRequest.id,
      kind: "booking_request",
      bookingRequestId: bookingRequest.id,
      postingId: bookingRequest.postingId,
      renterId: bookingRequest.renterId,
      organizationId: bookingRequest.organizationId,
      status: bookingRequest.status,
      sourceStatus: bookingRequest.status,
      startAt: bookingRequest.startAt,
      endAt: bookingRequest.endAt,
      durationDays: bookingRequest.durationDays,
      guestCount: bookingRequest.guestCount,
      pricingCurrency: bookingRequest.pricingCurrency,
      dailyPriceAmount: bookingRequest.dailyPriceAmount,
      estimatedTotal: bookingRequest.estimatedTotal,
      createdAt: bookingRequest.createdAt,
      updatedAt: bookingRequest.updatedAt,
      posting: bookingRequest.posting,
      holdExpiresAt: bookingRequest.holdExpiresAt,
      approvedAt: bookingRequest.approvedAt,
      paymentRequiredAt: bookingRequest.paymentRequiredAt,
      paymentFailedAt: bookingRequest.paymentFailedAt,
      convertedAt: bookingRequest.convertedAt,
      actionNeededCategory: isPaymentFailure
        ? "payment_failure"
        : isPaymentAction
          ? "payment"
          : undefined,
      isExpiringHold,
      nextAction,
      urgency: {
        level:
          isPaymentFailure || isExpiringHold
            ? "high"
            : isPaymentAction
              ? "medium"
              : isPending || isPaid
                ? "low"
                : "none",
        rank:
          isPaymentFailure || isExpiringHold
            ? 0
            : isPaymentAction
              ? 1
              : isPending
                ? 2
                : isPaid
                  ? 3
                  : 5,
        isActionable: isPaymentAction || isPaymentFailure,
        label: isPaymentFailure
          ? "Payment failed"
          : isExpiringHold
            ? "Hold expires soon"
            : isPaymentAction
              ? "Payment needed"
              : isPending
                ? "Pending"
                : isPaid
                  ? "Upcoming"
                  : "No urgency",
        deadlineAt,
      },
    };
  }

  private toRenterDashboardRentingItem(
    renting: RentingRecord,
  ): BookingDashboardItem {
    const nextAction =
      renting.status === "confirmed"
        ? {
            code: "view_renting" as const,
            label:
              renting.pickupInstructions && renting.returnInstructions
                ? "Review instructions before check-in."
                : "Watch for upcoming rental instructions.",
          }
        : renting.status === "check_in_ready"
          ? {
              code: "mark_check_in_complete" as const,
              label: "Confirm pickup or check-in when the rental starts.",
            }
          : renting.status === "active"
            ? {
                code: "mark_return_complete" as const,
                label: "Confirm return or check-out when the rental ends.",
              }
            : renting.status === "return_due"
              ? {
                  code: "mark_return_complete" as const,
                  label: "Confirm return or check-out now.",
                }
              : renting.status === "disputed"
                ? {
                    code: "view_renting" as const,
                    label: "A dispute is open for this renting.",
                  }
                : renting.status === "completed"
                  ? {
                      code: "none" as const,
                      label: "This renting has been completed.",
                    }
                  : {
                      code: "none" as const,
                      label: "No next action is required.",
                    };
    const urgency =
      renting.status === "disputed"
        ? {
            level: "high" as const,
            rank: 0,
            isActionable: true,
            label: "Dispute open",
          }
        : renting.status === "return_due"
          ? {
              level: "high" as const,
              rank: 1,
              isActionable: true,
              label: "Return due",
            }
          : renting.status === "active"
            ? {
                level: "medium" as const,
                rank: 2,
                isActionable: true,
                label: "Active",
              }
            : renting.status === "check_in_ready"
              ? {
                  level: "medium" as const,
                  rank: 3,
                  isActionable: true,
                  label: "Check-in ready",
                }
              : renting.status === "confirmed"
                ? {
                    level: "low" as const,
                    rank: 4,
                    isActionable: false,
                    label: "Upcoming",
                  }
                : {
                    level: "none" as const,
                    rank: 5,
                    isActionable: false,
                    label:
                      renting.status === "completed" ? "Completed" : "Closed",
                  };

    return {
      id: renting.id,
      kind: "renting",
      rentingId: renting.id,
      bookingRequestId: renting.bookingRequestId,
      postingId: renting.postingId,
      renterId: renting.renterId,
      organizationId: renting.organizationId,
      status: renting.status,
      sourceStatus: renting.status,
      startAt: renting.startAt,
      endAt: renting.endAt,
      durationDays: renting.durationDays,
      guestCount: renting.guestCount,
      pricingCurrency: renting.pricingCurrency,
      dailyPriceAmount: renting.dailyPriceAmount,
      estimatedTotal: renting.estimatedTotal,
      createdAt: renting.createdAt,
      updatedAt: renting.updatedAt,
      confirmedAt: renting.confirmedAt,
      pickupInstructions: renting.pickupInstructions,
      returnInstructions: renting.returnInstructions,
      checkInReadyAt: renting.checkInReadyAt,
      checkInCompletedAt: renting.checkInCompletedAt,
      returnDueAt: renting.returnDueAt,
      completedAt: renting.completedAt,
      disputedAt: renting.disputedAt,
      cancelledAt: renting.cancelledAt,
      dispute: renting.dispute,
      posting: {
        ...renting.posting,
        effectiveMaxBookingDurationDays:
          BOOKING_DEFAULTS.defaultMaxBookingDurationDays,
      },
      isExpiringHold: false,
      nextAction,
      urgency,
    };
  }

  private toOwnerDashboardRentingItem(
    renting: RentingRecord,
  ): BookingDashboardItem {
    const hasInstructions = Boolean(
      renting.pickupInstructions && renting.returnInstructions,
    );
    const nextAction =
      renting.status === "confirmed"
        ? hasInstructions
          ? {
              code: "mark_check_in_ready" as const,
              label: "Mark this renting as check-in ready.",
            }
          : {
              code: "update_instructions" as const,
              label: "Add pickup and return instructions before check-in.",
            }
        : renting.status === "check_in_ready"
          ? {
              code: "mark_check_in_complete" as const,
              label: "Confirm pickup or check-in when handoff happens.",
            }
          : renting.status === "active"
            ? {
                code: "mark_return_complete" as const,
                label: "Confirm return or check-out when the rental ends.",
              }
            : renting.status === "return_due"
              ? {
                  code: "mark_return_complete" as const,
                  label: "Confirm return or check-out now.",
                }
              : renting.status === "disputed"
                ? {
                    code: "view_renting" as const,
                    label: "A dispute is open for this renting.",
                  }
                : renting.status === "completed"
                  ? {
                      code: "none" as const,
                      label: "This renting has been completed.",
                    }
                  : {
                      code: "none" as const,
                      label: "No next action is required.",
                    };

    return {
      ...this.toRenterDashboardRentingItem(renting),
      nextAction,
    };
  }

  private toOwnerDashboardItem(
    bookingRequest: BookingRequestRecord,
  ): BookingDashboardItem {
    const isExpiringHold = this.isExpiringHold(
      bookingRequest.holdExpiresAt,
      bookingRequest.status,
    );
    const actionNeededCategory =
      this.resolveOwnerActionNeededCategory(bookingRequest);
    const nextAction =
      actionNeededCategory === "approval"
        ? {
            code: "review_request" as const,
            label: isExpiringHold
              ? "Approve or decline before the hold expires."
              : "Review and decide this booking request.",
          }
        : actionNeededCategory === "payment"
          ? {
              code: "complete_payment" as const,
              label: "Renter payment is still needed before the hold expires.",
            }
          : actionNeededCategory === "payment_failure"
            ? {
                code: "retry_payment" as const,
                label:
                  "Renter payment failed. Follow up before the hold expires.",
              }
            : actionNeededCategory === "conversion"
              ? {
                  code: "convert_to_renting" as const,
                  label: "Convert this paid booking into a confirmed renting.",
                }
              : {
                  code: "none" as const,
                  label: this.isTerminalBookingStatus(bookingRequest.status)
                    ? "No next action is required."
                    : "Watch this booking while it moves through the flow.",
                };
    const isActionable = Boolean(actionNeededCategory);

    return {
      id: bookingRequest.id,
      kind: "booking_request",
      bookingRequestId: bookingRequest.id,
      postingId: bookingRequest.postingId,
      renterId: bookingRequest.renterId,
      organizationId: bookingRequest.organizationId,
      status: bookingRequest.status,
      sourceStatus: bookingRequest.status,
      startAt: bookingRequest.startAt,
      endAt: bookingRequest.endAt,
      durationDays: bookingRequest.durationDays,
      guestCount: bookingRequest.guestCount,
      pricingCurrency: bookingRequest.pricingCurrency,
      dailyPriceAmount: bookingRequest.dailyPriceAmount,
      estimatedTotal: bookingRequest.estimatedTotal,
      createdAt: bookingRequest.createdAt,
      updatedAt: bookingRequest.updatedAt,
      posting: bookingRequest.posting,
      holdExpiresAt: bookingRequest.holdExpiresAt,
      approvedAt: bookingRequest.approvedAt,
      paymentRequiredAt: bookingRequest.paymentRequiredAt,
      paymentFailedAt: bookingRequest.paymentFailedAt,
      convertedAt: bookingRequest.convertedAt,
      actionNeededCategory,
      isExpiringHold,
      nextAction,
      urgency: {
        level:
          isExpiringHold || actionNeededCategory === "payment_failure"
            ? "high"
            : isActionable
              ? "medium"
              : this.isTerminalBookingStatus(bookingRequest.status)
                ? "none"
                : "low",
        rank:
          isExpiringHold || actionNeededCategory === "payment_failure"
            ? 0
            : isActionable
              ? 1
              : this.isTerminalBookingStatus(bookingRequest.status)
                ? 5
                : 3,
        isActionable,
        label: isExpiringHold
          ? "Hold expires soon"
          : actionNeededCategory === "approval"
            ? "Approval needed"
            : actionNeededCategory === "payment"
              ? "Awaiting payment"
              : actionNeededCategory === "payment_failure"
                ? "Payment failed"
                : actionNeededCategory === "conversion"
                  ? "Convert to renting"
                  : this.isTerminalBookingStatus(bookingRequest.status)
                    ? "Closed"
                    : "Open",
        deadlineAt: this.isTerminalBookingStatus(bookingRequest.status)
          ? undefined
          : bookingRequest.holdExpiresAt,
      },
    };
  }

  private resolveRenterBucket(
    item: BookingDashboardItem,
  ): RenterBookingDashboardBucket | null {
    if (item.kind === "renting") {
      const phase = this.resolveRentingPhase(item);
      return phase === "active"
        ? "active"
        : phase === "past"
          ? "past"
          : phase === "upcoming"
            ? "upcoming"
            : "cancelled";
    }

    if (
      ["approved", "awaiting_payment", "payment_failed"].includes(
        item.sourceStatus,
      )
    ) {
      return "action_needed";
    }

    if (item.sourceStatus === "pending") {
      return "pending";
    }

    if (
      ["declined", "expired", "cancelled", "refunded"].includes(
        item.sourceStatus,
      )
    ) {
      return "cancelled";
    }

    if (item.sourceStatus === "paid") {
      return new Date(item.endAt).getTime() < Date.now() ? "past" : "upcoming";
    }

    return null;
  }

  private resolveRentingPhase(
    item: BookingDashboardItem,
  ): "upcoming" | "active" | "past" | "cancelled" | null {
    if (item.kind !== "renting") {
      return null;
    }

    if (["confirmed", "check_in_ready"].includes(item.sourceStatus)) {
      return "upcoming";
    }

    if (["active", "return_due", "disputed"].includes(item.sourceStatus)) {
      return "active";
    }

    if (item.sourceStatus === "completed") {
      return "past";
    }

    if (item.sourceStatus === "cancelled") {
      return "cancelled";
    }

    return null;
  }

  private resolveOwnerActionNeededCategory(
    bookingRequest: BookingRequestRecord,
  ): OwnerBookingDashboardActionNeeded | undefined {
    if (bookingRequest.status === "pending") {
      return "approval";
    }

    if (
      bookingRequest.status === "approved" ||
      bookingRequest.status === "awaiting_payment"
    ) {
      return "payment";
    }

    if (bookingRequest.status === "payment_failed") {
      return "payment_failure";
    }

    if (
      bookingRequest.status === "paid" &&
      !bookingRequest.convertedAt &&
      !bookingRequest.rentingId
    ) {
      return "conversion";
    }

    return undefined;
  }

  private matchesOwnerActionNeeded(
    item: BookingDashboardItem,
    actionNeeded: OwnerBookingDashboardActionNeeded,
  ): boolean {
    if (actionNeeded === "expiring_hold") {
      return item.isExpiringHold;
    }

    return item.actionNeededCategory === actionNeeded;
  }

  private sortDashboardItems(
    items: BookingDashboardItem[],
    sort: BookingDashboardSort,
  ): BookingDashboardItem[] {
    return items.slice().sort((left, right) => {
      if (sort === "start_at") {
        const leftTerminal = this.isTerminalDashboardItem(left);
        const rightTerminal = this.isTerminalDashboardItem(right);

        if (leftTerminal !== rightTerminal) {
          return leftTerminal ? 1 : -1;
        }

        return (
          new Date(left.startAt).getTime() -
            new Date(right.startAt).getTime() ||
          new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
        );
      }

      return (
        left.urgency.rank - right.urgency.rank ||
        this.resolveDeadlineSortValue(left) -
          this.resolveDeadlineSortValue(right) ||
        new Date(left.startAt).getTime() - new Date(right.startAt).getTime() ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    });
  }

  private paginateDashboardItems(
    items: BookingDashboardItem[],
    page: number,
    pageSize: number,
  ) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      items: items.slice(start, end),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  private resolveDeadlineSortValue(item: BookingDashboardItem): number {
    const deadlineAt = item.urgency.deadlineAt;
    return deadlineAt
      ? new Date(deadlineAt).getTime()
      : Number.MAX_SAFE_INTEGER;
  }

  private isOwnerDashboardOpenItem(item: BookingDashboardItem): boolean {
    return (
      item.kind === "booking_request" &&
      !this.isTerminalBookingStatus(
        item.status as BookingRequestRecord["status"],
      )
    );
  }

  private isConvertedBooking(bookingRequest: BookingRequestRecord): boolean {
    return (
      bookingRequest.status === "paid" &&
      Boolean(bookingRequest.convertedAt || bookingRequest.rentingId)
    );
  }

  private isTerminalDashboardItem(item: BookingDashboardItem): boolean {
    if (item.kind === "renting") {
      return ["completed", "cancelled"].includes(item.status);
    }

    return (
      item.kind === "booking_request" &&
      this.isTerminalBookingStatus(
        item.status as BookingRequestRecord["status"],
      )
    );
  }

  private isTerminalBookingStatus(
    status: BookingRequestRecord["status"],
  ): boolean {
    return ["declined", "expired", "cancelled", "refunded"].includes(status);
  }

  private isExpiringHold(
    holdExpiresAt: string,
    status: BookingRequestRecord["status"],
  ): boolean {
    if (this.isTerminalBookingStatus(status)) {
      return false;
    }

    const expiresAt = new Date(holdExpiresAt).getTime();
    return expiresAt <= Date.now() + 24 * MILLISECONDS_PER_HOUR;
  }

  private async refundCancelledPaidBooking(
    bookingRequest: BookingRequestRecord,
    actorUserId: string,
    refundAmount: number,
    reason: string | null,
    currency: string,
  ): Promise<void> {
    const payment = await this.paymentsRepository.findByBookingRequestId(
      bookingRequest.id,
    );

    if (!payment) {
      throw new ConflictError(
        "This paid booking cannot be cancelled because its payment record is missing.",
      );
    }

    try {
      const idempotencyKey = `booking-cancel-${bookingRequest.id}`;
      const { refundId, providerPaymentId } =
        await this.paymentsRepository.createRefundRecord({
          paymentId: payment.id,
          actorUserId,
          amount: refundAmount,
          reason,
          idempotencyKey,
        });
      const result = await this.paymentProvider.createRefund({
        idempotencyKey,
        providerPaymentId,
        amount: refundAmount,
        currency,
        reason,
      });

      await this.paymentsRepository.completeRefund(refundId, result, {
        preserveBookingStatus: true,
      });

      if (result.status === "FAILED") {
        throw new ConflictError(
          "The refund could not be completed, so the booking was not cancelled.",
        );
      }
    } catch (error) {
      if (error instanceof BadRequestError || error instanceof ConflictError) {
        throw error;
      }

      const errorInfo = this.paymentProvider.classifyError(error);
      throw new ConflictError(
        `The refund could not be completed, so the booking was not cancelled. ${errorInfo.message}`,
      );
    }
  }

  private async requirePostingEditableForRenter(
    postingId: string,
  ): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (posting.archivedAt || posting.status !== "published") {
      throw new BadRequestError(
        "Pending booking requests cannot be updated for this posting.",
      );
    }

    return posting;
  }

  private async requirePostingActionableForOrganization(
    postingId: string,
  ): Promise<PostingRecord> {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (
      posting.archivedAt ||
      !["published", "paused"].includes(posting.status)
    ) {
      throw new BadRequestError(
        "This posting can no longer accept booking decisions.",
      );
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

  private async requireOrganizationBookingRequest(
    bookingRequestId: string,
    actorUserId: string,
    access: "read" | "manage",
  ): Promise<BookingRequestRecord> {
    const bookingRequest =
      await this.bookingsRepository.findById(bookingRequestId);

    if (!bookingRequest) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    const membership = await this.organizationAccessService.requireMembership(
      actorUserId,
      bookingRequest.organizationId,
      "You do not have access to this booking request.",
    );

    if (access === "manage") {
      this.organizationAccessService.assertCanManage(
        membership,
        "You do not have permission to manage this booking request.",
      );
    }

    return bookingRequest;
  }

  private async resolveCancellationActor(
    bookingRequest: BookingRequestRecord,
    userId: string,
  ): Promise<BookingCancellationActor> {
    if (bookingRequest.renterId === userId) {
      return "renter";
    }

    const membership = await this.organizationAccessService.requireMembership(
      userId,
      bookingRequest.organizationId,
      "You do not have access to this booking request.",
    );
    this.organizationAccessService.assertCanManage(
      membership,
      "You do not have permission to manage this booking request.",
    );

    return "owner";
  }

  private normalizeCancellationReason(
    reason: string | null | undefined,
  ): string | null {
    const normalized = reason?.trim() || null;

    if (
      normalized &&
      normalized.length > MAX_BOOKING_CANCELLATION_REASON_LENGTH
    ) {
      throw new BadRequestError(
        `Cancellation reason cannot exceed ${MAX_BOOKING_CANCELLATION_REASON_LENGTH} characters.`,
      );
    }

    return normalized;
  }

  private async assessCancellation(
    bookingRequest: BookingRequestRecord,
    userId: string,
  ): Promise<BookingCancellationAssessment> {
    const actor = await this.resolveCancellationActor(bookingRequest, userId);
    const reasonRequired = actor === "owner";
    const currency = bookingRequest.pricingCurrency;
    const failureReasons: BookingCancellationFailureReason[] = [];

    if (bookingRequest.rentingId || bookingRequest.convertedAt) {
      failureReasons.push({
        code: "booking_already_converted",
        message:
          "Converted bookings cannot be cancelled through booking requests.",
      });
    } else if (new Date(bookingRequest.startAt).getTime() <= Date.now()) {
      failureReasons.push({
        code: "already_started",
        message:
          "Bookings cannot be cancelled at or after the rental start time.",
      });
    } else if (bookingRequest.status === "payment_processing") {
      failureReasons.push({
        code: "payment_processing_in_progress",
        message:
          "This booking is currently processing payment and cannot be cancelled yet. Please retry once the payment finishes.",
      });
    } else if (
      !this.isCancellationStatusEligible(actor, bookingRequest.status)
    ) {
      failureReasons.push({
        code: "booking_status_ineligible",
        message: `Booking requests in status ${bookingRequest.status} cannot be cancelled.`,
      });
    }

    if (failureReasons.length > 0 || bookingRequest.status !== "paid") {
      return {
        actor,
        reasonRequired,
        refundType: "none",
        refundAmount: 0,
        currency,
        failureReasons,
      };
    }

    const payment = await this.paymentsRepository.findByBookingRequestId(
      bookingRequest.id,
    );

    if (!payment) {
      return {
        actor,
        reasonRequired,
        refundType: "unsupported",
        refundAmount: 0,
        currency,
        failureReasons: [
          {
            code: "payment_missing",
            message:
              "This paid booking cannot be cancelled because its payment record is unavailable.",
          },
        ],
      };
    }

    const refundableAmount = this.resolveRemainingRefundableAmount(payment);
    const refundAmount = this.resolveCancellationRefundAmount(
      actor,
      bookingRequest.startAt,
      refundableAmount,
    );
    const refundType = this.resolveRefundType(refundableAmount, refundAmount);

    return {
      actor,
      reasonRequired,
      refundType,
      refundAmount,
      currency: payment.pricingCurrency,
      failureReasons,
    };
  }

  private isCancellationStatusEligible(
    actor: BookingCancellationActor,
    status: BookingRequestRecord["status"],
  ): boolean {
    const renterStatuses: BookingRequestRecord["status"][] = [
      "pending",
      "approved",
      "awaiting_payment",
      "payment_failed",
      "paid",
    ];
    const ownerStatuses: BookingRequestRecord["status"][] = [
      "pending",
      "approved",
      "awaiting_payment",
      "payment_failed",
      "paid",
    ];

    return actor === "renter"
      ? renterStatuses.includes(status)
      : ownerStatuses.includes(status);
  }

  private resolveRemainingRefundableAmount(payment: {
    totalAmount: number;
    refunds: Array<{ status: string; amount: number }>;
  }): number {
    const succeededRefundTotal = payment.refunds
      .filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + refund.amount, 0);

    return Math.max(
      0,
      Math.round((payment.totalAmount - succeededRefundTotal) * 100) / 100,
    );
  }

  private resolveCancellationRefundAmount(
    actor: BookingCancellationActor,
    bookingStartAt: string,
    refundableAmount: number,
  ): number {
    if (refundableAmount <= 0) {
      return 0;
    }

    if (actor === "owner") {
      return refundableAmount;
    }

    const hoursUntilStart =
      (new Date(bookingStartAt).getTime() - Date.now()) / MILLISECONDS_PER_HOUR;

    if (hoursUntilStart > FULL_REFUND_CUTOFF_HOURS) {
      return refundableAmount;
    }

    if (hoursUntilStart > PARTIAL_REFUND_CUTOFF_HOURS) {
      return Math.round(refundableAmount * 50) / 100;
    }

    return 0;
  }

  private resolveRefundType(
    refundableAmount: number,
    refundAmount: number,
  ): BookingCancellationRefundType {
    if (refundableAmount <= 0) {
      return "none";
    }

    if (refundAmount >= refundableAmount) {
      return "full";
    }

    if (refundAmount > 0) {
      return "partial";
    }

    return "none";
  }

  private throwIfCancellationNotAllowed(
    assessment: BookingCancellationAssessment,
  ): void {
    const firstFailure = assessment.failureReasons[0];

    if (!firstFailure) {
      return;
    }

    if (firstFailure.code === "payment_processing_in_progress") {
      throw new ConflictError(firstFailure.message);
    }

    throw new BadRequestError(firstFailure.message, {
      code: firstFailure.code,
    });
  }

  private normalizeCreateInput(
    input: CreateBookingRequestInput,
    posting: PostingRecord,
  ): NormalizedCreateBookingRequestInput {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      startAt >= endAt
    ) {
      throw new BadRequestError(
        "Booking request dates must define a valid, non-empty range.",
      );
    }

    const durationDays = Math.ceil(
      (endAt.getTime() - startAt.getTime()) / MILLISECONDS_PER_DAY,
    );

    if (durationDays < 1) {
      throw new BadRequestError(
        "Booking requests must be at least one day long.",
      );
    }

    const effectiveMaxDuration =
      posting.maxBookingDurationDays ??
      BOOKING_DEFAULTS.defaultMaxBookingDurationDays;

    if (durationDays > effectiveMaxDuration) {
      throw new BadRequestError(
        `Booking duration cannot exceed ${effectiveMaxDuration} day${effectiveMaxDuration === 1 ? "" : "s"}.`,
      );
    }

    const dateFailure = this.checkBookingDateConstraints(
      posting,
      startAt,
      durationDays,
    );
    if (dateFailure) {
      throw new BadRequestError(dateFailure.message);
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

    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      startAt >= endAt
    ) {
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

    const durationDays = Math.ceil(
      (endAt.getTime() - startAt.getTime()) / MILLISECONDS_PER_DAY,
    );

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

    const dateFailure = this.checkBookingDateConstraints(
      posting,
      startAt,
      durationDays,
    );
    if (dateFailure) {
      failureReasons.push(dateFailure);
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
      posting.maxBookingDurationDays ??
      BOOKING_DEFAULTS.defaultMaxBookingDurationDays;
    const failureReasons: BookingQuoteFailureReason[] = [];

    if (posting.status !== "published" || posting.archivedAt) {
      failureReasons.push({
        code: "posting_unavailable",
        message: "Booking requests are only allowed for published postings.",
      });
    }

    const renterMembership =
      await this.organizationAccessService.findMembership(
        input.renterId,
        posting.organizationId,
      );

    if (renterMembership) {
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
      const [rentingOverlap, availabilityOverlap, activeRequestCount] =
        await Promise.all([
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
          message:
            "The requested dates are already reserved by an existing renting.",
        });
      }

      if (availabilityOverlap) {
        failureReasons.push({
          code: "availability_block_overlap",
          message:
            "The requested dates overlap with existing availability blocks.",
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

  private resolveGuestCountOrThrow(
    guestCount: number | undefined,
    posting: PostingRecord,
  ): number {
    if (posting.variant.family !== "place") {
      return 1;
    }

    if (
      guestCount === undefined ||
      !Number.isInteger(guestCount) ||
      guestCount < 1
    ) {
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

    if (
      guestCount === undefined ||
      !Number.isInteger(guestCount) ||
      guestCount < 1
    ) {
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
    const overlap =
      await this.bookingsRepository.hasBlockingAvailabilityOverlap({
        postingId,
        startAt,
        endAt,
        excludeBookingRequestId,
      });

    if (overlap) {
      throw new BadRequestError(
        "The requested dates overlap with existing availability blocks.",
      );
    }
  }

  private async assertWithinPostingRequestCap(
    postingId: string,
    renterId: string,
    excludeBookingRequestId?: string,
  ): Promise<void> {
    const activeRequestCount =
      await this.bookingsRepository.countActiveRequestsForRenterPosting({
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

  private async assertNoRentingOverlap(
    postingId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    const overlap = await this.rentingsRepository.hasOverlap(
      postingId,
      startAt,
      endAt,
    );

    if (overlap) {
      throw new BadRequestError(
        "The requested dates are already reserved by an existing renting.",
      );
    }
  }

  private effectiveDailyRate(
    pricing: PostingPricing,
    durationDays: number,
  ): number {
    if (durationDays >= 28 && pricing.monthly)
      return pricing.monthly.amount / 30;
    if (durationDays >= 7 && pricing.weekly) return pricing.weekly.amount / 7;
    return pricing.daily.amount;
  }

  private calculateEstimatedTotal(
    pricing: PostingPricing,
    durationDays: number,
    startAt?: Date,
    seasonalRules?: SeasonalPricingRecord[],
  ): number {
    if (startAt && seasonalRules && seasonalRules.length > 0) {
      const baseDailyRate = this.effectiveDailyRate(pricing, durationDays);
      let total = 0;
      for (let i = 0; i < durationDays; i++) {
        const day = new Date(startAt);
        day.setUTCDate(day.getUTCDate() + i);
        const dateStr = day.toISOString().slice(0, 10);
        // When multiple rules overlap a day, prefer the one with the latest endDate
        // (most specific/recent range wins). Round each addend to cents before summing
        // to avoid IEEE 754 drift across many days.
        const rule = seasonalRules
          .filter((r) => r.startDate <= dateStr && r.endDate >= dateStr)
          .sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
        const dayRate = rule ? rule.dailyAmount : baseDailyRate;
        total += Math.round(dayRate * 100) / 100;
      }
      return Math.round(total * 100) / 100;
    }

    if (durationDays >= 28 && pricing.monthly) {
      return (
        Math.round((pricing.monthly.amount / 30) * durationDays * 100) / 100
      );
    }
    if (durationDays >= 7 && pricing.weekly) {
      return Math.round((pricing.weekly.amount / 7) * durationDays * 100) / 100;
    }
    return Math.round(pricing.daily.amount * durationDays * 100) / 100;
  }

  private checkBookingDateConstraints(
    posting: PostingRecord,
    startAt: Date,
    durationDays: number,
  ): BookingQuoteFailureReason | null {
    if (
      posting.minBookingDurationDays &&
      durationDays < posting.minBookingDurationDays
    ) {
      return {
        code: "min_duration_not_met",
        field: "endAt",
        message: `Booking duration must be at least ${posting.minBookingDurationDays} day${posting.minBookingDurationDays === 1 ? "" : "s"}.`,
        details: {
          durationDays,
          minBookingDurationDays: posting.minBookingDurationDays,
        },
      };
    }

    if (posting.advanceNoticeDays != null) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const minStart = new Date(today);
      minStart.setUTCDate(today.getUTCDate() + posting.advanceNoticeDays);
      if (startAt < minStart) {
        return {
          code: "advance_notice_not_met",
          field: "startAt",
          message: `This listing requires ${posting.advanceNoticeDays} day${posting.advanceNoticeDays === 1 ? "" : "s"} advance notice.`,
          details: {
            advanceNoticeDays: posting.advanceNoticeDays,
            requiredStartDate: minStart.toISOString(),
          },
        };
      }
    }

    return null;
  }

  private addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }
}
