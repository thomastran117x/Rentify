import { createHash, randomUUID } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { BookingRequestRecord } from "@/features/bookings/bookings.model";
import type { ProfileRepository } from "@/features/profile/profile.repository";
import type {
  PublicPostingRecord,
  PostingRecord,
} from "@/features/postings/postings.model";
import { isPostingPubliclyVisible } from "@/features/postings/postings.model";
import type {
  RecommendationActivityEventPayload,
  RecommendationActivityEventType,
  RecommendationActivitySource,
  SearchClickActivityRequestBody,
} from "@/features/recommendations/recommendation-activity.model";
import type { RecommendationActivityQueueService } from "@/features/recommendations/recommendation-activity.queue.service";
import type { RentingRecord } from "@/features/rentings/rentings.model";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { type Uuid } from "@/configuration/validation/uuid";

export class RecommendationActivityPublisher {
  private readonly logger: Logger;

  constructor(
    private readonly queueService: RecommendationActivityQueueService,
    private readonly profileRepository: ProfileRepository,
  ) {
    this.logger = loggerFactory.forClass(
      RecommendationActivityPublisher,
      "service",
    );
  }

  async publishPostingView(input: {
    posting: PostingRecord | PublicPostingRecord;
    client: ClientRequestContext;
    requestId?: string;
    actorUserId?: Uuid;
  }): Promise<void> {
    if (
      !isPostingPubliclyVisible(input.posting) ||
      input.client.device.type === "bot"
    ) {
      return;
    }

    await this.publishBestEffort("posting_view", {
      eventId: randomUUID(),
      eventType: "posting_view",
      occurredAt: new Date().toISOString(),
      postingId: input.posting.id,
      actorUserId: input.actorUserId ?? null,
      anonymousActorHash: input.actorUserId
        ? null
        : this.createAnonymousActorHash(input.client),
      deviceType: input.client.device.type,
      requestId: input.requestId ?? null,
      source: "posting_detail",
      searchSessionId: null,
      metadata: {},
      personalizationEnabled: await this.readPersonalizationEnabled(
        input.actorUserId,
      ),
    });
  }

  async publishSearchClick(input: {
    postingId: Uuid;
    client: ClientRequestContext;
    body: SearchClickActivityRequestBody;
    requestId?: string;
    actorUserId?: Uuid;
  }): Promise<void> {
    if (input.client.device.type === "bot") {
      return;
    }

    await this.publishBestEffort("search_click", {
      eventId: randomUUID(),
      eventType: "search_click",
      occurredAt: new Date().toISOString(),
      postingId: input.postingId,
      actorUserId: input.actorUserId ?? null,
      anonymousActorHash: input.actorUserId
        ? null
        : this.createAnonymousActorHash(input.client),
      deviceType: input.client.device.type,
      requestId: input.requestId ?? null,
      source: "search_results",
      searchSessionId: input.body.searchSessionId,
      metadata: {
        query: input.body.query,
        family: input.body.family,
        subtype: input.body.subtype,
        page: input.body.page,
        position: input.body.position,
        hasGeoFilter: input.body.hasGeoFilter,
        hasAvailabilityFilter: input.body.hasAvailabilityFilter,
      },
      personalizationEnabled: await this.readPersonalizationEnabled(
        input.actorUserId,
      ),
    });
  }

  async publishBookingRequestCreated(input: {
    bookingRequest: BookingRequestRecord;
    client: ClientRequestContext;
    requestId?: string;
  }): Promise<void> {
    await this.publishBestEffort("booking_request_created", {
      eventId: randomUUID(),
      eventType: "booking_request_created",
      occurredAt: input.bookingRequest.createdAt,
      postingId: input.bookingRequest.postingId,
      actorUserId: input.bookingRequest.renterId,
      anonymousActorHash: null,
      deviceType: input.client.device.type,
      requestId: input.requestId ?? null,
      source: "booking_flow",
      searchSessionId: null,
      metadata: {
        bookingRequestId: input.bookingRequest.id,
        startAt: input.bookingRequest.startAt,
        endAt: input.bookingRequest.endAt,
        guestCount: input.bookingRequest.guestCount,
        status: input.bookingRequest.status,
      },
      personalizationEnabled: await this.readPersonalizationEnabled(
        input.bookingRequest.renterId,
      ),
    });
  }

  async publishRentingConfirmed(input: {
    renting: RentingRecord;
    client: ClientRequestContext;
    requestId?: string;
  }): Promise<void> {
    await this.publishBestEffort("renting_confirmed", {
      eventId: randomUUID(),
      eventType: "renting_confirmed",
      occurredAt: input.renting.confirmedAt,
      postingId: input.renting.postingId,
      actorUserId: input.renting.renterId,
      anonymousActorHash: null,
      deviceType: input.client.device.type,
      requestId: input.requestId ?? null,
      source: "renting_flow",
      searchSessionId: null,
      metadata: {
        rentingId: input.renting.id,
        bookingRequestId: input.renting.bookingRequestId,
        startAt: input.renting.startAt,
        endAt: input.renting.endAt,
        guestCount: input.renting.guestCount,
      },
      personalizationEnabled: await this.readPersonalizationEnabled(
        input.renting.renterId,
      ),
    });
  }

  async publishPostingLifecycle(input: {
    posting: PostingRecord;
    eventType:
      | "posting_published"
      | "posting_unpaused"
      | "posting_paused"
      | "posting_archived";
    client: ClientRequestContext;
    requestId?: string;
    actorUserId?: Uuid;
  }): Promise<void> {
    await this.publishBestEffort(input.eventType, {
      eventId: randomUUID(),
      eventType: input.eventType,
      occurredAt: new Date().toISOString(),
      postingId: input.posting.id,
      actorUserId: input.actorUserId ?? null,
      anonymousActorHash: null,
      deviceType: input.client.device.type,
      requestId: input.requestId ?? null,
      source: "posting_lifecycle",
      searchSessionId: null,
      metadata: {
        status: input.posting.status,
      },
      personalizationEnabled: await this.readPersonalizationEnabled(
        input.actorUserId,
      ),
    });
  }

  private async publishBestEffort(
    eventType: RecommendationActivityEventType,
    payload: RecommendationActivityEventPayload,
  ): Promise<void> {
    try {
      await this.queueService.publishActivityEvent(payload);
    } catch (error) {
      this.logger.warn(
        "Recommendation activity publish failed.",
        {
          eventType,
          postingId: payload.postingId,
          requestId: payload.requestId,
        },
        error,
      );
    }
  }

  private async readPersonalizationEnabled(
    userId?: Uuid,
  ): Promise<boolean | null> {
    if (!userId) {
      return null;
    }

    const enabled =
      await this.profileRepository.findRecommendationPersonalizationEnabledByUserId(
        userId,
      );

    return enabled ?? true;
  }

  private createAnonymousActorHash(client: ClientRequestContext): string {
    const fingerprintComponents = [
      `ip:${client.ip ?? "unknown"}`,
      `ua:${client.device.userAgent ?? "unknown"}`,
      `device:${client.device.id ?? "unknown"}`,
    ];

    return createHash("sha256")
      .update(fingerprintComponents.join("|"))
      .digest("hex");
  }
}
