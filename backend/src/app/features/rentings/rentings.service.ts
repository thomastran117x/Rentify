import type { AppRole } from "@/features/auth/auth.model";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import BadRequestError from "@/errors/http/bad-request.error";
import { CONVERSION_RESERVATION_MINUTES } from "@/features/bookings/bookings.model";
import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import {
  flowLockKeys,
  withFlowLock,
  withFlowLocks,
} from "@/features/cache/cache-locks";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type {
  ConvertBookingRequestInput,
  CreateRentingDisputeInput,
  ListMyRentingsInput,
  ListRentingsResult,
  RentingActorInput,
  RentingRecord,
  UpdateRentingInstructionsInput,
} from "@/features/rentings/rentings.model";
import { RENTING_DISPUTE_WINDOW_DAYS } from "@/features/rentings/rentings.model";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export class RentingsService {
  constructor(
    private readonly rentingsRepository: RentingsRepository,
    private readonly bookingsRepository: BookingsRepository,
    private readonly postingsAnalyticsRepository: PostingsAnalyticsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly cacheService: CacheService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  async convertApprovedBookingRequest(
    input: ConvertBookingRequestInput,
  ): Promise<RentingRecord> {
    const bookingRequest = await this.bookingsRepository.findById(
      input.bookingRequestId,
    );

    if (!bookingRequest) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    const membership = await this.organizationAccessService.requireMembership(
      input.actorUserId,
      bookingRequest.organizationId,
      "You do not have access to this booking request.",
    );
    this.organizationAccessService.assertCanManage(
      membership,
      "You do not have permission to convert this booking request.",
    );

    await this.requirePostingActionableForConversion(bookingRequest.postingId);

    const renting = await withFlowLocks(
      this.cacheService,
      [
        flowLockKeys.bookingRequestConvert(input.bookingRequestId),
        flowLockKeys.postingBookingWindow(bookingRequest.postingId),
      ],
      async () => {
        const reservation = await this.bookingsRepository.reserveForConversion(
          input.bookingRequestId,
          bookingRequest.organizationId,
          new Date(Date.now() + CONVERSION_RESERVATION_MINUTES * 60 * 1000),
        );
        await this.syncPostingSearchState(bookingRequest.postingId);

        try {
          const nextRenting =
            await this.rentingsRepository.convertApprovedBookingRequest(
              input.bookingRequestId,
              bookingRequest.organizationId,
            );

          if (!nextRenting) {
            throw new ResourceNotFoundError(
              "Booking request could not be found.",
            );
          }

          return nextRenting;
        } catch (error) {
          await this.bookingsRepository.releaseConversionReservation(
            input.bookingRequestId,
            bookingRequest.organizationId,
            reservation,
          );
          await this.syncPostingSearchState(bookingRequest.postingId);
          throw error;
        }
      },
      "Another request is already converting this booking request. Please retry.",
    );

    await this.postingsAnalyticsRepository.enqueueRentingConfirmedEvent({
      postingId: renting.postingId,
      organizationId: renting.organizationId,
      occurredAt: renting.confirmedAt,
      estimatedTotal: renting.estimatedTotal,
    });
    await this.syncPostingSearchState(renting.postingId);

    return renting;
  }

  async getById(
    id: string,
    userId: Uuid,
    role: AppRole = "user",
  ): Promise<RentingRecord> {
    await this.rentingsRepository.promoteReturnDueForRenting(
      asUuid(id),
      new Date(),
    );
    const renting = await this.rentingsRepository.findById(id);

    if (!renting) {
      throw new ResourceNotFoundError("Renting could not be found.");
    }

    await this.assertParticipantOrAdmin(renting, userId, role);
    return renting;
  }

  async listMine(input: ListMyRentingsInput): Promise<ListRentingsResult> {
    await this.rentingsRepository.promoteReturnDueForUser(
      input.userId,
      new Date(),
    );
    const membership = await this.organizationAccessService
      .requireActiveMembership(
        input.userId,
        "Select or join an organization before viewing organization rentings.",
      )
      .catch(() => null);

    return this.rentingsRepository.listMine({
      ...input,
      organizationId: membership?.organizationId,
    });
  }

  async updateInstructions(
    input: UpdateRentingInstructionsInput,
  ): Promise<RentingRecord> {
    return withFlowLock(
      this.cacheService,
      flowLockKeys.rentingState(input.rentingId),
      async () => {
        await this.rentingsRepository.promoteReturnDueForRenting(
          input.rentingId,
          new Date(),
        );
        const renting = await this.requireAccessibleRenting(
          input.rentingId,
          input.actorUserId,
          input.actorRole,
        );
        await this.assertOwnerOrAdmin(
          renting,
          input.actorUserId,
          input.actorRole,
        );

        if (renting.status === "cancelled") {
          throw new BadRequestError("Cancelled rentings cannot be updated.");
        }

        const updated = await this.rentingsRepository.updateInstructions(input);

        if (!updated) {
          throw new ResourceNotFoundError("Renting could not be found.");
        }

        return updated;
      },
      "Another request is already modifying this renting. Please retry.",
    );
  }

  async markCheckInReady(input: RentingActorInput): Promise<RentingRecord> {
    return withFlowLock(
      this.cacheService,
      flowLockKeys.rentingState(input.rentingId),
      async () => {
        await this.rentingsRepository.promoteReturnDueForRenting(
          input.rentingId,
          new Date(),
        );
        const renting = await this.requireAccessibleRenting(
          input.rentingId,
          input.actorUserId,
          input.actorRole,
        );
        await this.assertOwnerOrAdmin(
          renting,
          input.actorUserId,
          input.actorRole,
        );

        const updated = await this.rentingsRepository.markCheckInReady(
          input.rentingId,
          new Date(),
        );

        if (!updated) {
          throw new ResourceNotFoundError("Renting could not be found.");
        }

        return updated;
      },
      "Another request is already modifying this renting. Please retry.",
    );
  }

  async markCheckInComplete(input: RentingActorInput): Promise<RentingRecord> {
    return withFlowLock(
      this.cacheService,
      flowLockKeys.rentingState(input.rentingId),
      async () => {
        await this.rentingsRepository.promoteReturnDueForRenting(
          input.rentingId,
          new Date(),
        );
        const renting = await this.requireAccessibleRenting(
          input.rentingId,
          input.actorUserId,
          input.actorRole,
        );
        await this.assertParticipantOrAdmin(
          renting,
          input.actorUserId,
          input.actorRole,
        );

        const updated = await this.rentingsRepository.markCheckInComplete(
          input.rentingId,
          new Date(),
        );

        if (!updated) {
          throw new ResourceNotFoundError("Renting could not be found.");
        }

        return updated;
      },
      "Another request is already modifying this renting. Please retry.",
    );
  }

  async markCompleted(input: RentingActorInput): Promise<RentingRecord> {
    return withFlowLock(
      this.cacheService,
      flowLockKeys.rentingState(input.rentingId),
      async () => {
        await this.rentingsRepository.promoteReturnDueForRenting(
          input.rentingId,
          new Date(),
        );
        const renting = await this.requireAccessibleRenting(
          input.rentingId,
          input.actorUserId,
          input.actorRole,
        );
        await this.assertParticipantOrAdmin(
          renting,
          input.actorUserId,
          input.actorRole,
        );

        const updated = await this.rentingsRepository.markCompleted(
          input.rentingId,
          new Date(),
        );

        if (!updated) {
          throw new ResourceNotFoundError("Renting could not be found.");
        }

        return updated;
      },
      "Another request is already modifying this renting. Please retry.",
    );
  }

  async createDispute(
    input: CreateRentingDisputeInput,
  ): Promise<RentingRecord> {
    return withFlowLock(
      this.cacheService,
      flowLockKeys.rentingState(input.rentingId),
      async () => {
        await this.rentingsRepository.promoteReturnDueForRenting(
          input.rentingId,
          new Date(),
        );
        const renting = await this.requireAccessibleRenting(
          input.rentingId,
          input.actorUserId,
          input.actorRole,
        );
        await this.assertParticipantOrAdmin(
          renting,
          input.actorUserId,
          input.actorRole,
        );
        this.assertDisputeAllowed(renting, new Date());

        const updated = await this.rentingsRepository.createDispute(
          input,
          new Date(),
        );

        if (!updated) {
          throw new ResourceNotFoundError("Renting could not be found.");
        }

        return updated;
      },
      "Another request is already modifying this renting. Please retry.",
    );
  }

  private async requireAccessibleRenting(
    rentingId: Uuid,
    actorUserId: Uuid,
    actorRole: AppRole,
  ): Promise<RentingRecord> {
    const renting = await this.rentingsRepository.findById(rentingId);

    if (!renting) {
      throw new ResourceNotFoundError("Renting could not be found.");
    }

    await this.assertParticipantOrAdmin(renting, actorUserId, actorRole);
    return renting;
  }

  private async assertParticipantOrAdmin(
    renting: RentingRecord,
    actorUserId: Uuid,
    actorRole: AppRole,
  ): Promise<void> {
    if (actorRole === "admin") {
      return;
    }

    if (renting.renterId === actorUserId) {
      return;
    }

    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      renting.organizationId,
    );

    if (!membership) {
      throw new ForbiddenError("You do not have access to this renting.");
    }
  }

  private async assertOwnerOrAdmin(
    renting: RentingRecord,
    actorUserId: Uuid,
    actorRole: AppRole,
  ): Promise<void> {
    if (actorRole === "admin") {
      return;
    }

    const membership = await this.organizationAccessService.requireMembership(
      actorUserId,
      renting.organizationId,
      "Only organization managers can perform this renting action.",
    );
    this.organizationAccessService.assertCanManage(
      membership,
      "Only organization managers can perform this renting action.",
    );
  }

  private assertDisputeAllowed(renting: RentingRecord, now: Date): void {
    if (renting.dispute || renting.status === "disputed") {
      throw new BadRequestError(
        "A dispute has already been opened for this renting.",
      );
    }

    if (renting.status === "active" || renting.status === "return_due") {
      return;
    }

    if (renting.status !== "completed") {
      throw new BadRequestError(
        "Disputes can only be opened for active or recently completed rentings.",
      );
    }

    const completedAt = renting.completedAt
      ? new Date(renting.completedAt)
      : new Date(renting.endAt);
    const windowClosesAt =
      completedAt.getTime() +
      RENTING_DISPUTE_WINDOW_DAYS * MILLISECONDS_PER_DAY;

    if (windowClosesAt < now.getTime()) {
      throw new BadRequestError(
        "The dispute window for this renting has already closed.",
      );
    }
  }

  private async requirePostingActionableForConversion(
    postingId: Uuid,
  ): Promise<void> {
    const posting = await this.postingsRepository.findById(postingId);

    if (!posting) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    if (
      posting.archivedAt ||
      !["published", "paused"].includes(posting.status)
    ) {
      throw new ForbiddenError(
        "This posting can no longer be converted into a renting.",
      );
    }
  }

  private async syncPostingSearchState(postingId: Uuid): Promise<void> {
    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      postingId,
    );
    await this.postingsRepository.enqueueSearchSync(postingId);
  }
}
